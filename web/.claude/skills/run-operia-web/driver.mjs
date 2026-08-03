#!/usr/bin/env node
// Zero-dependency headless-Chromium driver for the Operia web app.
//
// Speaks CDP straight to the system chromium over Node's built-in WebSocket
// (Node >= 22), so it needs no npm packages and never touches web/package.json.
//
// Usage:  node .claude/skills/run-operia-web/driver.mjs <<'EOF'
//         nav http://localhost:5173/
//         wait-for text=Operia
//         screenshot login
//         EOF
//
// Commands (one per line, # comments and blank lines ignored):
// The UI is Danish-first with an English fallback. i18next-browser-languagedetector
// checks the querystring first, so `nav http://localhost:5173/?lng=da` (or ?lng=en)
// pins the language; chromium's --lang flag does NOT (navigator.language stays en-US
// in headless, so you silently get the English fallback).
//
// Commands (one per line, # comments and blank lines ignored):
//   nav <url>                 navigate and wait for load
//   login <email> <password>  sign in if not already signed in (idempotent)
//   logout                    drop the Supabase session and return to /login
//   wait-for text=<s>         wait until visible text appears (default 15s)
//   wait-for <cssSelector>    wait until selector matches a visible node
//   wait-gone text=<s>        wait until text disappears
//   click <cssSelector>       real mouse click at the element's centre
//   click text=<s>            click the innermost element containing text
//   fill <cssSelector> <val>  focus + native typing (fires React onChange)
//   press <key>               e.g. Enter, Tab, Escape
//   eval <js>                 evaluate in the page, print the result
//   text <cssSelector>        print an element's innerText
//   screenshot [name]         PNG -> $SHOT_DIR (default ./shots)
//   console                   dump collected console/page errors
//   sleep <ms>                last resort; prefer wait-for
//
// Exit code is non-zero if any command failed, so it works as a smoke test.

import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'

const CHROME = process.env.CHROME_BIN || 'chromium'
const PORT = Number(process.env.CDP_PORT || 9222)
const SHOT_DIR = resolve(process.env.SHOT_DIR || 'shots')
// Snap-packaged chromium's `home` interface only grants non-hidden paths under
// $HOME (AppArmor rule `owner @{HOME}/[^.]** rwklix`). A profile under /tmp *or*
// under any dot-dir like ~/.cache dies with "Failed to create a ProcessSingleton
// for your profile directory". Snap's own dir is always writable.
const PROFILE =
  process.env.CHROME_PROFILE || join(process.env.HOME, 'snap', 'chromium', 'current', 'operia-driver-profile')
const TIMEOUT = Number(process.env.WAIT_TIMEOUT || 15000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- chromium ---
async function launchChromium() {
  mkdirSync(PROFILE, { recursive: true })
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--remote-allow-origins=*',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--window-size=1440,900',
      `--user-data-dir=${PROFILE}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  let stderr = ''
  proc.stderr.on('data', (d) => (stderr += d))

  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return { proc, info: await res.json() }
    } catch {
      /* not up yet */
    }
    if (proc.exitCode !== null) {
      throw new Error(`chromium exited (${proc.exitCode}):\n${stderr.slice(-800)}`)
    }
    await sleep(150)
  }
  throw new Error(`chromium never opened CDP on :${PORT}\n${stderr.slice(-800)}`)
}

// --------------------------------------------------------------------- CDP ---
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.logs = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
        return
      }
      this.onEvent(msg)
    })
  }

  onEvent(msg) {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const type = msg.params.type
      if (type === 'error' || type === 'warning') {
        this.logs.push(`[console.${type}] ${msg.params.args.map(describe).join(' ')}`)
      }
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      this.logs.push(`[exception] ${d.exception?.description || d.text}`)
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      // network failures (failed fetch/XHR) surface here, not in console
      this.logs.push(`[network] ${msg.params.entry.text} ${msg.params.entry.url || ''}`.trim())
    }
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    }
    return r.result.value
  }
}

const describe = (a) => (a.value !== undefined ? String(a.value) : a.description || a.type)

// Page-side helper: resolve "text=foo" or a CSS selector to a visible element.
// Injected as an expression, so it stays a single self-contained function.
const FIND = `(function find(sel){
  const visible = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
  }
  if (sel.startsWith('text=')) {
    const needle = sel.slice(5).trim().toLowerCase()
    const hits = [...document.querySelectorAll('body *')].filter(
      (el) => visible(el) && (el.innerText || '').toLowerCase().includes(needle),
    )
    // innermost match wins, so clicking text= hits the button not <body>
    return hits.filter((el) => !hits.some((o) => o !== el && el.contains(o))).pop() || null
  }
  const el = document.querySelector(sel)
  return visible(el) ? el : null
})`

// ---------------------------------------------------------------- commands ---
async function boxOf(cdp, sel) {
  const box = await cdp.evaluate(
    `(() => { const el = ${FIND}(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({block:'center'});
      const r = el.getBoundingClientRect();
      return {x: r.x + r.width/2, y: r.y + r.height/2};
    })()`,
  )
  if (!box) throw new Error(`no visible element for ${sel}`)
  return box
}

async function waitFor(cdp, sel, want = true) {
  const deadline = Date.now() + TIMEOUT
  for (;;) {
    const found = await cdp.evaluate(`!!${FIND}(${JSON.stringify(sel)})`)
    if (found === want) return
    if (Date.now() > deadline) {
      throw new Error(`timeout after ${TIMEOUT}ms waiting for ${sel} to ${want ? 'appear' : 'disappear'}`)
    }
    await sleep(200)
  }
}

async function click(cdp, sel) {
  const { x, y } = await boxOf(cdp, sel)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
    })
  }
}

async function fill(cdp, sel, value) {
  await boxOf(cdp, sel) // assert it exists / scroll it in
  await cdp.evaluate(
    `(() => { const el = ${FIND}(${JSON.stringify(sel)}); el.focus();
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
      setter ? setter.call(el, '') : (el.value = '');
      el.dispatchEvent(new Event('input', {bubbles:true}));
    })()`,
  )
  // insertText goes through the real input pipeline, so React's onChange fires
  await cdp.send('Input.insertText', { text: value })
}

const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
}

async function press(cdp, keyName) {
  const k = KEYS[keyName]
  if (!k) throw new Error(`unknown key ${keyName} (known: ${Object.keys(KEYS).join(', ')})`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k })
}

async function screenshot(cdp, name) {
  mkdirSync(SHOT_DIR, { recursive: true })
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = join(SHOT_DIR, `${name}.png`)
  // node writes the file, not chromium — so snap confinement does not apply here
  writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

// The user-menu avatar renders only inside the authenticated app shell and
// carries no translated text, so it is the language-independent "signed in" probe.
const SHELL = '[data-slot="avatar"]'
const BASE = process.env.BASE_URL || 'http://localhost:5173/'

async function login(cdp, email, password) {
  if (await cdp.evaluate(`!!${FIND}(${JSON.stringify(SHELL)})`)) return 'already signed in'
  await waitFor(cdp, '#email')
  await fill(cdp, '#email', email)
  await fill(cdp, '#password', password)
  await click(cdp, 'button[type="submit"]')
  // the submit button relabels to "Loading…" before navigating, so waiting on
  // the button's text going away returns far too early — wait for the shell
  await waitFor(cdp, SHELL)
  return `signed in as ${email}`
}

async function logout(cdp) {
  await cdp.evaluate(`(() => { localStorage.clear(); sessionStorage.clear(); })()`)
  await cdp.send('Page.navigate', { url: BASE })
  await waitFor(cdp, '#email')
  return 'signed out'
}

async function run(cdp, line) {
  const [cmd, ...rest] = line.split(/\s+/)
  const arg = rest.join(' ')
  switch (cmd) {
    case 'nav': {
      await cdp.send('Page.navigate', { url: arg })
      // Vite serves instantly but the SPA mounts async; wait for React's root
      await waitFor(cdp, '#root > *')
      return `navigated to ${arg}`
    }
    case 'login':
      return await login(cdp, rest[0], rest.slice(1).join(' '))
    case 'logout':
      return await logout(cdp)
    case 'wait-for':
      await waitFor(cdp, arg, true)
      return `found ${arg}`
    case 'wait-gone':
      await waitFor(cdp, arg, false)
      return `gone ${arg}`
    case 'click':
      await click(cdp, arg)
      return `clicked ${arg}`
    case 'fill': {
      // Quote the selector when it contains spaces: fill 'input[placeholder^="Søg på"]' MSØ
      // (an unquoted one would split mid-selector and type the rest of it as the value —
      // and CSS error-recovery closes the dangling quote, so it silently half-works).
      const quoted = arg.match(/^(['"])(.+?)\1\s+([\s\S]*)$/)
      const sel = quoted ? quoted[2] : rest[0]
      const value = quoted ? quoted[3] : rest.slice(1).join(' ')
      await fill(cdp, sel, value)
      return `filled ${sel}`
    }
    case 'press':
      await press(cdp, arg)
      return `pressed ${arg}`
    case 'text':
      return JSON.stringify(
        await cdp.evaluate(`(${FIND}(${JSON.stringify(arg)}) || {}).innerText ?? null`),
      )
    case 'eval':
      return JSON.stringify(await cdp.evaluate(`(async () => (${arg}))()`, true))
    case 'screenshot':
      return `wrote ${await screenshot(cdp, arg || `shot-${cdp.id}`)}`
    case 'console':
      return cdp.logs.length ? cdp.logs.join('\n') : '(no console errors)'
    case 'sleep':
      await sleep(Number(arg))
      return `slept ${arg}ms`
    default:
      throw new Error(`unknown command: ${cmd}`)
  }
}

// -------------------------------------------------------------------- main ---
const script = await new Promise((res) => {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => (buf += d))
  process.stdin.on('end', () => res(buf))
})

const lines = script
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))

const { proc, info } = await launchChromium()
console.log(`# ${info.Browser}`)

const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then(
  (r) => r.json(),
)
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', () => rej(new Error('CDP websocket failed')), { once: true })
})

const cdp = new Cdp(ws)
await cdp.send('Page.enable')
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')

let failed = false
for (const line of lines) {
  try {
    console.log(`> ${line}\n  ${await run(cdp, line)}`)
  } catch (err) {
    console.error(`> ${line}\n  FAILED: ${err.message}`)
    failed = true
    try {
      console.error(`  (state captured: ${await screenshot(cdp, 'failure')})`)
    } catch {
      /* page may be gone */
    }
    break
  }
}

ws.close()
proc.kill('SIGTERM')
process.exit(failed ? 1 : 0)

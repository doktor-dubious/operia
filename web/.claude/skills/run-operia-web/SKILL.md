---
name: run-operia-web
description: Build, run, and drive the Operia admin web app. Use when asked to start the web app, run the dev server, log in, click through a screen, take a screenshot of the UI, verify a change in the real app, or build/test web/.
---

Operia's admin SPA (Vite + React + TanStack Router, Supabase backend). An agent
drives it by starting the dev server against the **local** Supabase stack and
piping a command script to `.claude/skills/run-operia-web/driver.mjs` — a
zero-dependency headless-Chromium driver that speaks CDP over Node's built-in
`WebSocket`. There is no `chromium-cli` and no Playwright on this machine; the
driver is the harness.

All paths below are relative to `web/`.

## Prerequisites

Already present on this machine — nothing to `apt-get`:

```bash
node -v            # v24.15.0 (needs >= 22 for the global WebSocket)
which chromium     # /snap/bin/chromium — the snap build, see Gotchas
docker info        # must be running, for the local Supabase stack
```

## Setup

Dependencies are installed (`node_modules/` exists). If starting from a clean
clone: `npm install`.

Bring up the local Supabase stack. **Always drive against local, not the hosted
project** — it is seeded with a demo company and a known login, and writes can't
damage customer data:

```bash
cd /home/rune/workspace/projects/operia
supabase start              # ~15s if the containers already exist
supabase db reset --local   # ~60s: replays every migration, then seed.sql
```

`db reset` applies every migration plus `supabase/seed.sql`, which creates
company "DCA Demo A/S", 3 employees, 4 parcels, and the login
**demo@operia.local / operia123** (manager + parcel_handler). Skip the reset only
if you know the local DB is already current — a stale one 404s on newer tables
(see Troubleshooting).

**After any `db reset`, restart Kong** — it caches the auth container's IP and
otherwise 502s every login (see Gotchas):

```bash
docker restart supabase_kong_operia && sleep 6
```

## Run (agent path)

Point the dev server at the local stack by writing `.env.local` — Vite layers it
over `.env`, and it is already gitignored by the `*.local` rule. **Don't use
exported `VITE_*` shell vars**: they are lost the moment anything respawns vite,
and the app silently falls back to `.env` — i.e. the **hosted** project.

```bash
eval "$(cd .. && supabase status -o env | grep -E '^(API_URL|ANON_KEY)=')"
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\n' "$API_URL" "$ANON_KEY" > .env.local
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill; sleep 2
nohup npm run dev > /tmp/operia-vite.log 2>&1 &
timeout 40 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done'
```

**Assert which backend you actually got before driving anything.** Reading the
config proves nothing; hook `fetch` and look at where a real sign-in goes:

```bash
node .claude/skills/run-operia-web/driver.mjs <<'EOF'
nav http://localhost:5173/
logout
eval (() => { window.__hosts=new Set(); const of=fetch; window.fetch=(...a)=>{ try{window.__hosts.add(new URL(String(a[0]),location.href).host)}catch{} return of(...a) }; return 'hooked' })()
login demo@operia.local operia123
eval [...window.__hosts]
EOF
```

Must print `["127.0.0.1:54321"]`. If you see `*.supabase.co`, **stop** — you are
driving the customers' production database, and every failed sign-in you try
writes a permanent row into an append-only audit log.

When you're done, `rm .env.local` and restart the dev server, so the human's
`npm run dev` goes back to their own `.env`.

Then drive it. This is the full smoke test — login, navigate, register a parcel,
assert the result — and it exits non-zero if any step fails:

```bash
SHOT_DIR=shots node .claude/skills/run-operia-web/driver.mjs <<'EOF'
nav http://localhost:5173/parcels/receive?lng=da
login demo@operia.local operia123
wait-for #barcode
fill #barcode DRIVER-SMOKE-001
fill 'input[placeholder^="Søg på navn"]' MSØ
wait-for text=Mette Sørensen
click text=Mette Sørensen
sleep 500
click text=Modtag Pakke
wait-for text=DRIVER-SMOKE-001
screenshot 07-parcel-created
console
EOF
```

Screenshots land in `web/shots/` (gitignored). **Look at the PNG** — a rendered
shell with every fetch 500ing still counts as "loaded". End scripts with
`console` to surface network/JS errors, which the driver collects silently.

Verify writes actually landed, rather than trusting the toast:

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -tAc "select barcode, status from public.parcels where barcode='DRIVER-SMOKE-001';"
```

### Driver commands

| command | what it does |
|---|---|
| `nav <url>` | navigate, wait for React to mount (`#root > *`) |
| `login <email> <pw>` | idempotent — no-op if already signed in |
| `logout` | clears localStorage, returns to `/login` |
| `wait-for text=<s>` / `wait-for <css>` | poll up to `WAIT_TIMEOUT` (default 15s) |
| `wait-gone …` | same, inverted |
| `click <css>` / `click text=<s>` | real mouse events at the element's centre |
| `fill <css> <value>` | focus + `Input.insertText`, so React `onChange` fires |
| `press <key>` | Enter, Tab, Escape, ArrowDown, ArrowUp |
| `eval <js>` | evaluate in the page (await-ed), print JSON |
| `text <css>` | print an element's innerText |
| `screenshot [name]` | PNG → `$SHOT_DIR` (default `./shots`) |
| `console` | dump collected console errors, exceptions, failed requests |
| `sleep <ms>` | last resort — prefer `wait-for` |

Env: `SHOT_DIR`, `WAIT_TIMEOUT`, `BASE_URL`, `CDP_PORT`, `CHROME_BIN`,
`CHROME_PROFILE`.

## Run (human path)

`npm run dev` → open http://localhost:5173 → Ctrl-C. Uses `web/.env` as-is,
which points at the **hosted** project (real customer data) — unless a leftover
`.env.local` from the agent path is still there. Useless headless.

## Build and test

```bash
npm run build    # tsc -b && vite build — ~13s, writes dist/
npm run lint     # oxlint — exits 0 with ~196 pre-existing warnings
```

Every lint warning is `react(only-export-components)` (Fast-refresh nagging about
route files that export both a component and a helper). They are pre-existing —
don't read them as damage from your change.

There is no unit-test suite in `web/`; the driver script above is the test.

## Gotchas

- **One script = one browser.** Each `driver.mjs` invocation launches and kills
  its own chromium. A multi-step flow must be a single heredoc — you cannot
  `click` in one invocation and `submit` in the next. Only the Supabase session
  survives (via the persistent profile dir), which is why `login` is idempotent.
- **Snap chromium can only write to non-hidden paths under `$HOME`.** Its
  AppArmor profile is `owner @{HOME}/[^.]** rwklix`, so a `--user-data-dir` under
  `/tmp` *or* under `~/.cache` dies instantly with "Failed to create a
  ProcessSingleton for your profile directory". The driver defaults to
  `~/snap/chromium/current/operia-driver-profile`. Screenshots are exempt —
  **node** writes those over CDP, not chromium, so `SHOT_DIR` can be anywhere.
- **`docker restart supabase_kong_operia` after every `supabase db reset`.**
  The reset recreates the auth container with a new IP; Kong keeps the old one
  and returns `{"message":"An invalid response was received from the upstream
  server"}` for `/auth/v1/*`. The UI renders this as "Sign-in failed. Check your
  email and password." — i.e. **correct credentials look wrong**. Tell the two
  apart by bypassing Kong — a token from GoTrue directly, while `:54321` still
  502s, is the Kong bug and not bad credentials:

  ```bash
  docker exec supabase_auth_operia wget -qO- \
    --post-data='{"email":"demo@operia.local","password":"operia123"}' \
    --header='Content-Type: application/json' \
    'http://localhost:9999/token?grant_type=password'
  ```
- **The UI language is Danish-first with an English fallback, and headless
  chromium reports `en-US`** — so you silently get *English* labels while a human
  on the same build sees Danish. Chromium's `--lang` flag does not change
  `navigator.language`. Use the querystring detector instead: `?lng=da` (or
  `?lng=en`). It persists to localStorage for the rest of the session, so
  selectors written against Danish text keep matching.
- **Quote `fill` selectors containing spaces**: `fill 'input[placeholder^="Søg på
  navn"]' MSØ`. Unquoted, the selector splits at the first space and the
  remainder is typed as the value — and because CSS error-recovery closes the
  dangling quote, the selector still *matches*, so it half-works with garbage
  input instead of failing.
- **Don't wait on a submit button's text disappearing.** "Modtag Pakke" /
  "Sign In" relabels to "Loading…" the instant it is clicked, so `wait-gone
  text=Sign In` returns while still on `/login`. `login` waits for
  `[data-slot="avatar"]` — the user-menu avatar, which exists only in the
  authenticated shell and carries no translated text.
- **`logout` resets the UI language.** It clears localStorage, which is where
  i18next cached the `?lng=da` pin — so everything after a `logout` renders in
  English again and Danish `wait-for text=…` selectors stop matching. Re-`nav` to
  `…/?lng=da` after logging out.
- **A 5xx from auth hangs the button for ~20s.** `auth-js` retries
  `AuthRetryableFetchError` with backoff before giving up, so the submit button
  sits on "Indlæser…" long past the default 15s wait. Use
  `WAIT_TIMEOUT=90000` when driving auth failure paths.
- **Blur-triggered validation won't fire from `fill` alone.** The receive form's
  duplicate-barcode lookup runs on `onBlur`/Enter (scanners emit Enter), not
  `onChange`, so `fill #barcode …` leaves the field focused and the warning never
  appears. Add `press Tab`. Assume the same for any other on-blur check.
- **The smoke test is re-runnable but not idempotent.** Duplicate barcodes are
  *warn-and-allow* by design, so a second run adds another parcel with barcode
  `DRIVER-SMOKE-001` rather than failing. Don't assert on row counts. To clean
  up, `supabase db reset --local` — deleting parcels by hand means disabling the
  `parcel_events` immutability trigger, which isn't worth it.
- **Nav is entitlement-gated.** The sidebar shows only products in
  `company_products`; an empty sidebar usually means a stale local DB, not a
  routing bug.

## Troubleshooting

- **`chromium exited (21) … Failed to create … SingletonLock: Permission
  denied`**: profile dir is under a dot-dir or `/tmp`. See the snap gotcha above.
- **Sidebar has only "Home"; console shows 404 on `platform_settings` /
  `rpc/log_login_success` and 400 on `company_products…product_catalog`**: the
  local DB predates recent migrations. `supabase db reset --local`, then restart
  Kong.
- **`no visible element for #email` when you expected the login page**: the
  driver profile still holds a valid Supabase session, so the app went straight
  to `/`. Prepend `logout`, or use `login` (idempotent) instead of hand-filling.
- **`timeout … waiting for [data-slot="avatar"]` right after `logout`**: the
  Kong/auth 502. Restart Kong.
- **`EADDRINUSE` on 5173**: `lsof -ti:5173 -sTCP:LISTEN | xargs -r kill`. `$!`
  after `npm run dev &` is only the npm wrapper — killing it leaves vite holding
  the port.

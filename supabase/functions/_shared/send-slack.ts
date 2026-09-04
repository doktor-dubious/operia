// Fælles: send en Slack-besked til modtageren som direkte besked (DM).
//
// `to` er ENTEN et Slack-medlems-id (employees.slack_user_id, den manuelle
// tilsidesættelse) ELLER medarbejderens e-mail — se recipient() i channels.ts.
// Formen aflæses her, så dispatcheren slipper for at kende forskellen:
//   e-mail → users.lookupByEmail → chat.postMessage
//   id     →                       chat.postMessage
// Tilsidesættelsen sparer altså opslaget, som er det hårdest rate-limitede
// kald (Tier 2, ~20/minut).
//
// Bemærk at der IKKE kaldes conversations.open først, selv om det er den
// gængse opskrift på en DM: chat.postMessage tager et bruger-id direkte som
// 'channel' og åbner samtalen selv. Forskellen er rettigheder —
// conversations.open kræver im:write, mens den direkte vej klarer sig med
// chat:write. Det er ét scope færre at bede kunden om (og at forsvare i deres
// sikkerhedsgennemgang), ét kald mindre pr. besked, og ingen geninstallation
// hos dem der allerede har forbundet.
//
// Tokenet er PR. KUNDE: kunden installerer vores Slack-app i sit eget workspace
// (OAuth, se edge-funktionerne slack-config/slack-oauth), og bot-tokenet ligger
// i company_slack_secret, som hverken har RLS-politikker eller grants. Det
// hentes gennem ctx.companySecret, så denne fil aldrig rører databaseklienten.
//
// GDPR: Slack (Salesforce) er databehandler for de beskeder der sendes her.
// docs/gdpr/subprocessors + ROPA + compliance-map skal nævne kanalen, så længe
// den er i brug hos mindst én kunde.

import type { SendContext, SendResult } from './channels.ts'

const SLACK_API = 'https://slack.com/api'

// Slack afviser beskeder over 4000 tegn. Statussammendraget kan i teorien blive
// langt ({{parcel_list}} med mange pakker), og en afvist besked er værre end en
// forkortet — så klippes den hellere med en tydelig markør.
const MAX_TEXT = 3900

// Slack-medlems-id: 'U' (eller 'W' på Enterprise Grid) + versaler/cifre. Samme
// regel som check-constrainten employees_slack_user_id_format, så de to ikke
// kan komme ud af trit om hvad der er et id og hvad der er en e-mail.
const MEMBER_ID = /^[UW][A-Z0-9]{6,20}$/

// Fejlkoder fra Slack der betyder "prøv igen senere" frem for "opgiv".
// ratelimited håndteres separat via HTTP 429.
const RETRYABLE_SLACK_ERRORS = new Set([
  'service_unavailable',
  'internal_error',
  'fatal_error',
  'request_timeout',
])

// ── Caches ──────────────────────────────────────────────────────────────────
// Edge-runtime genbruger isolatet mellem kald, så en modulcache overlever et
// stykke tid — men kun i DET isolat; der er ingen måde at rydde den på tværs
// af isolater, så alt her lever på en TTL frem for på en "glem"-funktion:
//
//   • Tokenet er kort (30 s): afbryder kunden forbindelsen, må vi ikke blive
//     ved med at sende ind i deres workspace mange minutter efter.
//   • Bruger-id'et er langt (10 min): e-mail → Slack-bruger er stabilt, og
//     users.lookupByEmail er rate-limited hårdere (Tier 2, ~20 kald/min) end
//     de øvrige. Uden cachen ville en stor kunde ramme loftet på én kørsel.
//     Nøglen er TOKENET (ikke kunde-id'et): forbinder kunden til et andet
//     workspace, skifter tokenet, og et medlems-id fra det gamle workspace kan
//     ikke blive hængende.
//   • NEGATIVE opslag (personen findes ikke i workspacet) huskes også, og
//     længere (1 time): det er det dyre tilfælde — en medarbejder uden Slack
//     ville ellers koste et rate-limitet opslag ved hver eneste kørsel.
//   • Pause pr. kunde efter 429/5xx: Slack svarer med retry-after, og indtil
//     den er gået, svares der forbigående uden at kalde Slack. Dispatcheren
//     springer i forvejen resten af kundens Slack-sendinger over i samme
//     kørsel; pausen dækker isolatets næste kørsler også.
type Cached<T> = { value: T; at: number }
const TOKEN_TTL_MS = 30_000
const USER_TTL_MS = 600_000
const USER_MISS_TTL_MS = 3_600_000
const DEFAULT_BACKOFF_MS = 30_000
const MAX_BACKOFF_MS = 600_000
const tokenCache = new Map<string, Cached<string | null>>()
const userCache = new Map<string, Cached<string>>()
const userMissCache = new Map<string, Cached<true>>()
const backoffUntil = new Map<string, number>()

function cacheGet<T>(m: Map<string, Cached<T>>, key: string, ttl: number): T | undefined {
  const hit = m.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > ttl) {
    m.delete(key)
    return undefined
  }
  return hit.value
}

async function botToken(ctx: SendContext): Promise<string | null> {
  const hit = cacheGet(tokenCache, ctx.companyId, TOKEN_TTL_MS)
  if (hit !== undefined) return hit
  const token = await ctx.companySecret('company_slack_secret', 'bot_token')
  tokenCache.set(ctx.companyId, { value: token, at: Date.now() })
  return token
}

function pause(companyId: string, retryAfterSeconds: number | null): void {
  const ms = retryAfterSeconds != null && retryAfterSeconds > 0
    ? Math.min(retryAfterSeconds * 1000, MAX_BACKOFF_MS)
    : DEFAULT_BACKOFF_MS
  backoffUntil.set(companyId, Date.now() + ms)
}

function paused(companyId: string): boolean {
  const until = backoffUntil.get(companyId)
  if (until == null) return false
  if (Date.now() >= until) {
    backoffUntil.delete(companyId)
    return false
  }
  return true
}

// ── API-kald ────────────────────────────────────────────────────────────────
type SlackResponse = { ok: boolean; error?: string; [k: string]: unknown }

/**
 * Ét Slack-kald. Skelner tre udfald, fordi de skal behandles forskelligt
 * opstrøms: lykkedes, permanent fejl, forbigående fejl (`retry`).
 */
async function call(
  method: string,
  token: string,
  body: Record<string, unknown>,
  companyId: string,
): Promise<{ data?: SlackResponse; error?: string; retry?: boolean }> {
  let res: Response
  try {
    // FORM-encoding, ikke JSON. Slacks Web API tager x-www-form-urlencoded på
    // alle metoder, men JSON kun på et udvalg — users.lookupByEmail er ikke
    // blandt dem og svarer 'invalid_arguments' på et JSON-legeme. Vores tre
    // kald har kun simple strengparametre, så én kodning dækker dem alle.
    const form = new URLSearchParams()
    for (const [k, v] of Object.entries(body)) {
      if (v != null) form.set(k, String(v))
    }
    res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body: form.toString(),
    })
  } catch (err) {
    // Netværksfejl er altid værd at prøve igen på.
    return { error: `slack_network: ${String(err).slice(0, 200)}`, retry: true }
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after')
    pause(companyId, retryAfter != null ? Number(retryAfter) : null)
    return { error: `slack_ratelimited: retry-after=${retryAfter ?? '?'}`, retry: true }
  }
  if (res.status >= 500) {
    pause(companyId, null)
    return { error: `slack_${res.status}`, retry: true }
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { error: `slack_${res.status}: ${detail.slice(0, 200)}` }
  }

  let data: SlackResponse
  try {
    data = (await res.json()) as SlackResponse
  } catch {
    return { error: 'slack_bad_response', retry: true }
  }
  if (!data.ok) {
    const code = String(data.error ?? 'unknown')
    // missing_scope svarer med præcis hvilke rettigheder der mangler og hvilke
    // tokenet har. Uden dem siger loggen kun "missing_scope", og man er nødt
    // til at gætte hvilket af kaldene der fejlede — behold detaljen.
    const detail = code === 'missing_scope'
      ? ` needed=${String(data.needed ?? '?')} provided=${String(data.provided ?? '?')}`
      : ''
    return { error: `slack_${code}${detail}`, retry: RETRYABLE_SLACK_ERRORS.has(code) }
  }
  return { data }
}

const NOT_FOUND = 'slack_users_not_found'

async function lookupUser(
  ctx: SendContext,
  token: string,
  email: string,
): Promise<{ id?: string; error?: string; retry?: boolean }> {
  const key = `${token}:${email.toLowerCase()}`
  const hit = cacheGet(userCache, key, USER_TTL_MS)
  if (hit) return { id: hit }
  if (cacheGet(userMissCache, key, USER_MISS_TTL_MS)) return { error: NOT_FOUND }

  const r = await call('users.lookupByEmail', token, { email }, ctx.companyId)
  // Slacks egen "findes ikke" kommer som fejlkoden users_not_found (call()
  // sætter 'slack_' foran) — et permanent, cachebart svar, ikke en sendefejl.
  const id = r.error ? undefined : (r.data?.user as { id?: string } | undefined)?.id
  if (r.error === NOT_FOUND || (!r.error && !id)) {
    userMissCache.set(key, { value: true, at: Date.now() })
    return { error: NOT_FOUND }
  }
  if (r.error) return { error: r.error, retry: r.retry }
  userCache.set(key, { value: id!, at: Date.now() })
  return { id }
}

export async function sendSlack(
  to: string,
  message: string,
  ctx: SendContext,
): Promise<SendResult> {
  let token: string | null
  try {
    token = await botToken(ctx)
  } catch (err) {
    // Opslaget selv fejlede (databaseudfald) — det er IKKE det samme som at
    // kunden mangler en installation, og må ikke brænde et forsøg.
    return { ok: false, error: `slack_secret_unavailable: ${String(err).slice(0, 150)}`, retryable: true }
  }
  // Ingen installation for denne kunde. Permanent indtil nogen forbinder
  // Slack igen — classifySendError oversætter til 'slack_not_configured'.
  if (!token) return { ok: false, error: 'slack_not_configured' }

  // Slack har bedt os vente (429/5xx for nylig): svar forbigående uden at
  // kalde — hvert kald i pausen ville blot forlænge den.
  if (paused(ctx.companyId)) {
    return { ok: false, error: 'slack_ratelimited: backoff', retryable: true }
  }

  let userId: string
  if (MEMBER_ID.test(to)) {
    userId = to
  } else {
    const user = await lookupUser(ctx, token, to)
    if (!user.id) return { ok: false, error: user.error, retryable: user.retry }
    userId = user.id
  }

  const text = message.length > MAX_TEXT ? `${message.slice(0, MAX_TEXT)}…` : message
  const post = await call('chat.postMessage', token, { channel: userId, text }, ctx.companyId)
  if (post.error) return { ok: false, error: post.error, retryable: post.retry }

  // ts er beskedens id i Slack — gemmes som provider_id i afsendelsesloggen.
  const ts = post.data?.ts
  return { ok: true, id: ts != null ? String(ts) : undefined }
}

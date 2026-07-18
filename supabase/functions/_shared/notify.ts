// Fælles hjælpere for notifikations-dispatcherne (pakker + aktiv-udlån): rolle-
// tjek af cron-kaldet, token-rendering, datoformat og stilletids-beregning i
// Europe/Copenhagen. Holdes ét sted, så de to dispatchere ikke divergerer.

export const DAY = 86_400_000
export const TZ = 'Europe/Copenhagen'

// Rolle-claim fra et (allerede signatur-verificeret) JWT — cron-kaldet kommer
// fra service-role. Robust mod nøgleversion/whitespace vs. eksakt streng-match.
export function jwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return typeof decoded.role === 'string' ? decoded.role : null
  } catch {
    return null
  }
}

// Er kald-tokenet service-role? (JWT-rolle 'service_role', med eksakt nøgle-
// match som fallback for lokale/afvigende opsætninger.)
export function isServiceRole(token: string, serviceKey: string): boolean {
  return !!token && (jwtRole(token) === 'service_role' || token === serviceKey)
}

// Kort maskinkode for et afsendelsesudfald → Logs-fremviseren oversætter den til
// læsbar tekst (logsPage.msg.reason*), i stedet for at vise et råt Resend/Gateway-
// API-svar. En 422 fra Resend ('validation_error') eller vores egen for-check
// betyder en ugyldig modtageradresse — den hyppige tastefejl (komma o.l.).
export function classifySendError(err: string, channel: 'email' | 'sms'): string {
  const e = (err || '').toLowerCase()
  if (channel === 'email') {
    if (e.includes('invalid_email') || e.includes('validation_error') || e.includes('resend_422'))
      return 'invalid_email'
    if (e.includes('not_configured')) return 'email_not_configured'
    return 'email_error'
  }
  if (e.includes('invalid_recipient')) return 'invalid_phone'
  if (e.includes('not_configured')) return 'sms_not_configured'
  return 'sms_error'
}

// Erstat {{snake_case}}-tokens; ukendte tokens efterlades urørt.
// hasOwnProperty via Object.prototype (ikke `k in tokens`), så nedarvede
// prototype-nøgler ({{constructor}}, {{toString}} …) ikke rammer native-funktioner
// men behandles som ukendte tokens og efterlades urørt.
export function render(str: string, tokens: Record<string, string>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
    Object.prototype.hasOwnProperty.call(tokens, k) ? tokens[k] : `{{${k}}}`,
  )
}

// HTML-escape af en tokenVÆRDI før den interpoleres i en e-mail-krop. Skabelon-
// teksten kan bevidst indeholde markup, men navne/stregkoder o.l. er data og må
// aldrig injicere tags eller bryde layoutet.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Render en skabelon-krop til e-mail-HTML: tokenværdier escapes altid, og
// plain-text-krop (uden markup) får linjeskift → <br>. Vigtigt: markup-checken
// køres på RÅ-skabelonen (før substitution), så en tokenværdi der indeholder '<'
// ikke fejlagtigt får hele beskeden til at stå på én linje.
export function renderHtml(body: string, tokens: Record<string, string>): string {
  const escaped: Record<string, string> = {}
  for (const k of Object.keys(tokens)) escaped[k] = escapeHtml(tokens[k])
  let html = render(body, escaped)
  if (!body.includes('<')) html = html.replace(/\n/g, '<br>')
  return html
}

// Skabelon-resolver, delt af dispatcherne: virksomheds-override vinder over
// platform-standard; fald tilbage til dansk hvis modtagerens sprog mangler.
type TemplateRow = {
  company_id?: string
  key: string
  lang: string
  title: string | null
  body: string | null
}
export function resolveTemplate(
  platformTpls: TemplateRow[],
  companyTpls: TemplateRow[],
  companyId: string,
  key: string,
  lang: string,
): { title: string; body: string } {
  const l = (lang || 'da').slice(0, 2)
  const co =
    companyTpls.find((r) => r.company_id === companyId && r.key === key && r.lang === l) ??
    companyTpls.find((r) => r.company_id === companyId && r.key === key && r.lang === 'da')
  const pf =
    platformTpls.find((r) => r.key === key && r.lang === l) ??
    platformTpls.find((r) => r.key === key && r.lang === 'da')
  return { title: co?.title || pf?.title || '', body: co?.body || pf?.body || '' }
}

export function fmtDate(iso: string, lang: string): string {
  const loc = lang.startsWith('en') ? 'en-GB' : 'da-DK'
  return new Intl.DateTimeFormat(loc, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: TZ,
  }).format(new Date(iso))
}

// Kalenderdato (YYYY-MM-DD) i Europe/Copenhagen — så "i dag" følger den lokale
// dag og ikke UTC. Entitlements' valid_until er en dato i lokal forretningstid;
// nær midnat ville en UTC-dato ellers ligge en dag forkert.
export function copenhagenDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}

// Minutter siden midnat i Europe/Copenhagen — stilletiden er lokal tid.
export function copenhagenMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return h * 60 + m
}

function toMin(t: string | null): number | null {
  if (!t) return null
  const [h, m] = t.split(':')
  return Number(h) * 60 + Number(m)
}

export function inQuietHours(nowMin: number, start: string | null, end: string | null): boolean {
  const s = toMin(start)
  const e = toMin(end)
  if (s == null || e == null || s === e) return false
  return s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e
}

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
//
// `channel` tages som streng (ikke Channel-typen) med vilje: channels.ts
// importerer render/renderHtml herfra, og en typeimport den anden vej ville
// lukke en cirkel. Ukendte kanaler falder tilbage på en generisk kode frem for
// at blive fejlklassificeret som SMS.
export function classifySendError(err: string, channel: string): string {
  const e = (err || '').toLowerCase()
  const notConfigured = e.includes('not_configured')
  switch (channel) {
    case 'email':
      if (e.includes('invalid_email') || e.includes('validation_error') || e.includes('resend_422'))
        return 'invalid_email'
      return notConfigured ? 'email_not_configured' : 'email_error'
    case 'sms':
      if (e.includes('invalid_recipient')) return 'invalid_phone'
      return notConfigured ? 'sms_not_configured' : 'sms_error'
    case 'teams':
      // Ingen objekt-id på medarbejderen (typisk: kunden kører CSV-import og
      // ikke AD-synkronisering) er en anden fejl end "kanalen mangler opsætning".
      if (e.includes('no_recipient') || e.includes('user_not_found')) return 'invalid_teams_user'
      return notConfigured ? 'teams_not_configured' : 'teams_error'
    case 'slack':
      if (e.includes('users_not_found') || e.includes('no_recipient')) return 'invalid_slack_user'
      // Kunden har afinstalleret appen (eller tilbagekaldt tokenet): kanalen er
      // død indtil nogen forbinder igen. Egen kode, fordi handlingen er en
      // anden end ved en almindelig sendefejl.
      if (e.includes('token_revoked') || e.includes('invalid_auth') ||
          e.includes('account_inactive')) return 'slack_auth_revoked'
      return notConfigured ? 'slack_not_configured' : 'slack_error'
    default:
      return notConfigured ? 'channel_not_configured' : 'channel_error'
  }
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

// 'HH:MM[:SS]' (Postgres time) → minutter siden midnat. null for tom/ugyldig.
export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null
  const [h, m] = t.split(':')
  const min = Number(h) * 60 + Number(m)
  return Number.isFinite(min) ? min : null
}

export function inQuietHours(nowMin: number, start: string | null, end: string | null): boolean {
  const s = timeToMinutes(start)
  const e = timeToMinutes(end)
  if (s == null || e == null || s === e) return false
  return s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e
}

// Maskér en modtager før den skrives i revisionsloggen. audit_log er
// UPDATE/DELETE-spærret og videresendes til kundens log drains, så en fuld
// e-mailadresse eller et mobilnummer dér kan aldrig fjernes igen — heller ikke
// når pakken/udlånet siden anonymiseres. Maskeringen bevarer det man fejlsøger
// på (hvilken slags adresse, hvilket domæne, de sidste cifre) uden at gemme
// selve identifikatoren.
// `channel` er valgfri: aktiv-påmindelserne kalder stadig med ét argument, og
// e-mail/SMS genkendes fint på formen. Den er nødvendig for de kanaler hvor
// adressen er et ugennemsigtigt id — et Entra-objekt-id er en UUID, og
// cifferstien nedenfor ville hakke den i stykker til noget der ligner et
// telefonnummer. Et id er stadig en personhenførbar identifikator, så det
// maskeres; de sidste tegn bevares, så to rækker kan skelnes under fejlsøgning.
export function maskRecipient(
  value: string | null | undefined,
  channel?: string,
): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  // Teams adresserer altid på et objekt-id; Slack kan gøre begge dele (id-
  // tilsidesættelse eller e-mail), så dér afgøres det af værdiens form.
  if (channel === 'teams') return maskOpaqueId(v)
  if (channel === 'slack' && !v.includes('@')) return maskOpaqueId(v)
  const at = v.indexOf('@')
  if (at > 0) {
    const local = v.slice(0, at)
    const head = local.length <= 2 ? local[0] : local.slice(0, 2)
    return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${v.slice(at + 1)}`
  }
  const digits = v.replace(/\D/g, '')
  if (digits.length >= 4) return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`
  return '****'
}

// Ugennemsigtigt id (Entra-objekt-id, Slack-bruger-id): behold de sidste 4 tegn
// som telefonnumre, stjernemarkér resten. Længden bevares ikke ud over 24 tegn,
// så en lang identifikator ikke fylder loggen.
function maskOpaqueId(v: string): string {
  if (v.length <= 4) return '****'
  const stars = Math.min(v.length - 4, 20)
  return `${'*'.repeat(stars)}${v.slice(-4)}`
}

// Rens en fejltekst fra en udbyder, før den GEMMES.
//
// parcel_notifications.error / asset_loan_notifications.error / log_drains.
// last_error indeholder det rå svar fra Resend, GatewayAPI eller kundens eget
// logsystem — og et afvist forsøg citerer rutinemæssigt adressen der fejlede
// ("550 5.1.1 <anna@firma.dk> unknown"). Rækken bevares som dokumentation for
// forsøget, men modtageren har vi allerede besluttet ikke at opbevare i klar
// tekst (se maskRecipient og trigger'en der rydder recipient ved lukning), og
// så må den ikke smutte ind ad bagdøren i fejlteksten.
//
// Maskeringen sker HER, ved lagringen — ikke i selve afsenderen: det svar der
// returneres til den manager, som lige har trykket "send test", må gerne vise
// adressen, for vedkommende har selv indtastet den.
export function sanitizeProviderError(
  value: string | null | undefined,
  max = 500,
): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  return v
    // E-mailadresser, uanset hvor i teksten de står.
    .replace(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => maskRecipient(m) ?? '***')
    // GUID'er: Teams/Graph citerer rutinemæssigt bruger- og tenant-objekt-id'et
    // i sine fejlsvar, og et objekt-id er en personhenførbar identifikator.
    // Cifferreglen nedenfor fanger dem ikke (bindestreger bryder matchet), så
    // de maskeres for sig — ellers ville de lande uslettelige i audit_log.
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      (m) => maskRecipient(m, 'teams') ?? '***',
    )
    // Telefonnumre: 8+ cifre i træk, evt. med mellemrum eller parenteser.
    // Bindestreger og koloner bryder bevidst et match, så datoer og
    // klokkeslæt ('2026-08-14 03:22') står læseligt tilbage — korte tal
    // (statuskoder, portnumre) ligeså. En SAMMENHÆNGENDE talrække på 8+ cifre
    // maskeres stadig, også når den er et udbyder-id: et nummer der slipper
    // ind i en immutable log, kan aldrig fjernes igen, så tvivlen falder ud
    // til maskering.
    .replace(/\+?\d(?:[\d\s()]{6,})\d/g, (m) =>
      m.replace(/\D/g, '').length >= 8 ? (maskRecipient(m) ?? '***') : m,
    )
    .slice(0, max)
}

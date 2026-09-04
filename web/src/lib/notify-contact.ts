// Notifikationskanaler, set fra klienten.
//
// Spejler supabase/functions/_shared/channels.ts — det er serveren der afgør
// hvad der faktisk sendes; det her lag findes for at kunne VISE det samme svar
// (kanalvalg i Konfigurér → Notifikationer, og advarslen ved modtagelse om at
// modtageren ikke kan nås). De to filer skal ændres sammen: en kanal der kun
// findes ét af stederne giver enten en usynlig kanal eller en løgnagtig
// advarsel.

export const NOTIFY_CHANNELS = ['email', 'sms', 'teams', 'slack'] as const
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number]

// Kan kanalen levere i dag? Spejler ChannelSpec.available i channels.ts. Teams'
// afsender er en stub, så kanalen er skjult (ingen afkrydsning, ingen advarsel,
// ingen serie i statistikken) indtil integrationen findes. NOTIFY_CHANNELS
// beholder den, fordi enum, kolonner og gamle rækker stadig kender den.
export const CHANNEL_AVAILABLE: Record<NotifyChannel, boolean> = {
  email: true,
  sms: true,
  teams: false,
  slack: true,
}
export const AVAILABLE_CHANNELS: NotifyChannel[] = NOTIFY_CHANNELS.filter(
  (c) => CHANNEL_AVAILABLE[c],
)

// Kanalernes til/fra-kolonner som select-liste til PostgREST. Skal være en
// STRENGLITERAL: supabase-js udleder rækketypen ved at parse select-strengen på
// typeniveau, og en streng bygget på runtime (join over CHANNEL_TOGGLE) giver en
// ParserError-type i stedet for en række — så forsvinder felt-typningen på hele
// svaret. Hold den i sync med CHANNEL_TOGGLE nedenfor. Samme afvejning som
// CHANNEL_TOGGLE_COLUMNS i channels.ts.
export const CHANNEL_TOGGLE_SELECT =
  'notify_email_enabled, notify_sms_enabled, notify_teams_enabled, notify_slack_enabled'

// Kolonnen på companies/platform_settings der slår kanalen til. Samme
// kolonnenavne som i channels.ts.
export const CHANNEL_TOGGLE: Record<NotifyChannel, string> = {
  email: 'notify_email_enabled',
  sms: 'notify_sms_enabled',
  teams: 'notify_teams_enabled',
  slack: 'notify_slack_enabled',
}

// Tilvalg pr. kunde kanalen kræver (company_features). null = intet tilvalg.
export const CHANNEL_FEATURE: Record<NotifyChannel, string | null> = {
  email: null,
  sms: 'sms_notifications',
  teams: 'teams_notifications',
  slack: 'slack_notifications',
}

export const CHANNEL_LABEL_KEY: Record<NotifyChannel, string> = {
  email: 'notificationsPage.channelEmail',
  sms: 'notificationsPage.channelSms',
  teams: 'notificationsPage.channelTeams',
  slack: 'notificationsPage.channelSlack',
}

// Kan modtageren overhovedet nås på en given kanal? Spejler dispatcherens
// regler: e-mail sendes som den står (Resend afviser ugyldige), SMS normaliseres
// med toMsisdn i supabase/functions/_shared/send-sms.ts — 8 cifre antages dansk,
// ellers kræves landekode (9–15 cifre i alt). Hold i sync med den.

export function hasValidEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const e = email.trim()
  return e.includes('@') && !e.startsWith('@') && !e.endsWith('@')
}

export function hasValidMsisdn(phone: string | null | undefined): boolean {
  if (!phone) return false
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 8) return true // bart dansk nummer — får 45 foran
  return digits.length >= 9 && digits.length <= 15
}

// Medarbejderfelterne kanalerne adresserer på. external_id er Entra-objekt-
// id'et, som Teams bruger — en kunde på CSV-import har ingen, og for dem kan
// Teams-kanalen altså ikke nå nogen.
//
// Bemærk de TRE tilstande for external_id: en streng (kan nås), null (hentet,
// personen har ingen) og undefined (IKKE hentet). Sidstnævnte opstår hvor
// medarbejderen kommer fra AI-fortolkningens match-RPC, som endnu ikke
// projicerer feltet. Den skelnen bruges af hasChannelContact nedenfor.
export type ChannelContact = {
  email?: string | null
  phone?: string | null
  external_id?: string | null
  slack_user_id?: string | null
}

// Virksomhedens kanalvalg ud over til/fra: må Slack slå modtagere op på
// e-mail? Spejler companies.slack_lookup_by_email (CHANNEL_OPTION_COLUMNS).
export type ChannelOptions = {
  slack_lookup_by_email?: boolean | null
}

/**
 * Kan modtageren nås på kanalen?
 *
 * Ved ukendt adresse (feltet er slet ikke hentet) svares TRUE. Funktionen
 * bruges kun til at ADVARE om at en modtager ikke kan nås, og en falsk advarsel
 * er værre end ingen — samme afvejning som resten af modtagelses-formularen,
 * der heller ikke advarer før konfigurationen er hentet.
 *
 * Opfølgning: får ai_match_label_fields engang external_id med i sine
 * kandidater, forsvinder undefined-tilstanden af sig selv.
 */
export function hasChannelContact(
  channel: NotifyChannel,
  emp: ChannelContact,
  options: ChannelOptions = {},
): boolean {
  switch (channel) {
    case 'email':
      return hasValidEmail(emp.email)
    case 'sms':
      return hasValidMsisdn(emp.phone)
    case 'teams':
      if (emp.external_id === undefined) return true // ukendt — advar ikke
      return !!emp.external_id?.trim()
    case 'slack':
      // Et udfyldt medlems-id er en sikker adresse. Ellers — og kun hvis
      // kunden har slået det til — slås brugeren op på e-mailen
      // (users.lookupByEmail), så en gyldig e-mail er FORUDSÆTNINGEN, ikke en
      // garanti for at personen findes i kundens workspace. Det kan kun
      // serveren afgøre. Er slack_user_id slet ikke hentet (undefined), advares
      // der ikke — samme regel som for Teams.
      if (emp.slack_user_id === undefined) return true
      if (emp.slack_user_id?.trim()) return true
      return options.slack_lookup_by_email === true && hasValidEmail(emp.email)
  }
}

/**
 * Læsbar tekst for en årsagskode fra classifySendError (notify.ts) eller
 * send-test-status' egne koder ('no_recipient', 'no_template'). Bruges af
 * BÅDE Logs og status-testdialogen, så en fejl hedder det samme begge steder.
 * Ukendte koder vises råt frem for at forsvinde.
 */
// Struktur-typet t frem for i18next' brandede TFunction: kaldes både med
// useTranslation()'s t og med Logs' egen smallere TFn.
type TranslateFn = (key: string, opts?: Record<string, unknown>) => string

export function notifyReasonLabel(code: string | null | undefined, t: TranslateFn): string {
  if (!code) return t('common.unknown', { defaultValue: 'ukendt' })
  const key = `logsPage.msg.reason${code.replace(/(^|_)([a-z])/g, (_m, _s, c: string) => c.toUpperCase())}`
  const text = t(key)
  return text === key ? code : text
}

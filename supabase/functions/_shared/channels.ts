// Notifikationskanaler ét sted.
//
// Før denne fil var kanalvalget spredt ud som 'channel === "email" ? … : …' i
// dispatcheren og i send-test-status: adressefelt, skabelonnøgle, rendering og
// afsender stod fire forskellige steder, og en tredje kanal ville have krævet
// en ændring i alle fire (og i praksis fire chancer for at glemme én).
//
// Her beskrives en kanal ÉN gang — hvilket tilvalg den kræver, hvilken kolonne
// der slår den til, hvor modtageradressen kommer fra, hvilket skabelon-suffiks
// den bruger, og hvordan kroppen renderes og sendes. Kalderne itererer over
// registret i stedet for at kende kanalerne.
//
// Teams er med i registret, men afsenderen er endnu tom (se send-teams.ts).
// Det er med vilje: rørene skal være færdige og gennemtestede før provider-
// integrationen bygges oven på dem. Indtil da er kanalen markeret
// `available: false`: den filtreres fra i enabledChannels/selectedChannels
// (uanset til/fra-kolonne og tilvalg), og UI'et skjuler afkrydsningen. Uden den
// spærring ville et tilvalg + et kryds være nok til at nå den tomme afsender og
// fylde loggen med 'failed'-rækker for en kanal der ikke kan levere.

import { sendEmail } from './send-email.ts'
import { sendSms } from './send-sms.ts'
import { sendTeams } from './send-teams.ts'
import { sendSlack } from './send-slack.ts'
import { render, renderHtml } from './notify.ts'

export const CHANNELS = ['email', 'sms', 'teams', 'slack'] as const
export type Channel = (typeof CHANNELS)[number]

export type SendResult = {
  ok: boolean
  error?: string
  id?: string
  /**
   * Fejlen er FORBIGÅENDE (rate limit, 5xx hos udbyderen) — prøv igen næste
   * kørsel. Kalderen må ikke logge en 'failed'-række for den: dedup-loggen
   * tæller mod MAX_ATTEMPTS, så tre rate limits i træk ville ellers opgive
   * beskeden for altid. En permanent fejl (ukendt modtager, ugyldigt token)
   * skal derimod logges og tælle med.
   */
  retryable?: boolean
}

/**
 * Det en kanal må vide om afsendelsen ud over selve beskeden.
 *
 * `companySecret` findes fordi Slack (og senere Teams) installeres PR. KUNDE:
 * tokenet ligger i en service-role-tabel og kan ikke være en global edge-secret
 * som RESEND_API_KEY. Konteksten giver kanalen én opslagsfunktion i stedet for
 * hele service-role-klienten — så slipper registret for at kende supabase-js'
 * generiske klienttype, og dispatcheren for at kende kanalernes tabeller.
 */
export type SendContext = {
  companyId: string
  companySecret: (table: string, column: string) => Promise<string | null>
}

// Kun de felter kanalregistret selv rører. Bredere end EmployeeRow med vilje:
// både dispatcheren og testfunktionen kan sende deres egen medarbejderform ind.
export type ChannelRecipient = {
  email?: string | null
  phone?: string | null
  external_id?: string | null
  slack_user_id?: string | null
}

// Kanalvalget læses samme sted begge veje: virksomhedens override (null = arv)
// falder tilbage på platformens standard. Samme række bærer også kanalernes
// øvrige pr.-kunde-valg (CHANNEL_OPTION_COLUMNS), fx om Slack må slå
// modtagere op på e-mail.
export type ChannelSettings = Record<string, unknown>

type ChannelSpec = {
  // Kan kanalen levere i dag? false = afsenderen er en stub; kanalen holdes
  // ude af alle kanalvalg, så den hverken kan vælges eller nås.
  available: boolean
  // Tilvalg pr. kunde (company_features). null = kanalen kræver intet tilvalg.
  feature: string | null
  // Kolonnen i både platform_settings og companies der slår kanalen til.
  toggle: string
  // Hvor modtageradressen kommer fra. En FUNKTION og ikke et feltnavn, fordi
  // en kanal kan have mere end én kilde: Slack foretrækker den manuelle
  // tilsidesættelse (employees.slack_user_id) og falder — kun hvis kunden har
  // slået det til — tilbage på e-mailen. Derfor får den også virksomhedens
  // indstillinger med.
  recipient: (emp: ChannelRecipient, company: ChannelSettings) => string | null
  // Skabelonnøglens suffiks. E-mail er basen uden suffiks — det er derfor
  // e-mail-nøglerne hedder 'package_arrival' og SMS 'package_arrival_sms'.
  templateSuffix: string
  // Renderes kroppen som HTML (e-mail) eller ren tekst (SMS/chat)?
  format: 'html' | 'text'
  send: (to: string, title: string, body: string, ctx: SendContext) => Promise<SendResult>
}

export const CHANNEL_SPEC: Record<Channel, ChannelSpec> = {
  email: {
    available: true,
    feature: null,
    toggle: 'notify_email_enabled',
    recipient: (emp) => emp.email ?? null,
    templateSuffix: '',
    format: 'html',
    send: (to, title, body) => sendEmail(to, title, body),
  },
  sms: {
    available: true,
    feature: 'sms_notifications',
    toggle: 'notify_sms_enabled',
    recipient: (emp) => emp.phone ?? null,
    templateSuffix: '_sms',
    format: 'text',
    // SMS har ingen emnelinje — titlen er tom i skabelonerne og ignoreres.
    send: (to, _title, body) => sendSms(to, body),
  },
  teams: {
    // Afsenderen er en stub (send-teams.ts) — kanalen er skjult og uden for
    // alle kanalvalg indtil Bot Framework-integrationen findes.
    available: false,
    feature: 'teams_notifications',
    toggle: 'notify_teams_enabled',
    // Entra-objekt-id'et, som AD-synkroniseringen allerede skriver.
    recipient: (emp) => emp.external_id ?? null,
    templateSuffix: '_teams',
    format: 'text',
    send: (to, _title, body, ctx) => sendTeams(to, body, ctx),
  },
  slack: {
    available: true,
    feature: 'slack_notifications',
    toggle: 'notify_slack_enabled',
    // Tilsidesættelsen vinder når den er sat. Opslag på e-mail (inde i
    // afsenderen, users.lookupByEmail) kræver at kunden har slået det til:
    // uden den spærring ville kanalen forsøges for HVER medarbejder med en
    // e-mail — hos en kunde hvor kun få har Slack, giver det et rate-limitet
    // opslag plus en 'failed'-række og en fejl i Logs pr. forsøg for alle de
    // øvrige. sendSlack kender begge former.
    recipient: (emp, co) =>
      emp.slack_user_id ?? (co.slack_lookup_by_email === true ? emp.email ?? null : null),
    templateSuffix: '_slack',
    format: 'text',
    send: (to, _title, body, ctx) => sendSlack(to, body, ctx),
  },
}

// Kanaler der kan levere i dag (se ChannelSpec.available).
export const AVAILABLE_CHANNELS: Channel[] = CHANNELS.filter((c) => CHANNEL_SPEC[c].available)

// Alle tilvalgsnøgler kanalerne kan kræve — bruges til at afgrænse opslaget i
// company_features, så en ny kanal ikke kræver en ændring i forespørgslen.
export const CHANNEL_FEATURES: string[] = [
  ...new Set(CHANNELS.map((c) => CHANNEL_SPEC[c].feature).filter((f): f is string => !!f)),
]

// Kanalernes til/fra-kolonner som select-liste. Både platform_settings og
// companies har dem med samme navne. Hentes de ikke, ser enabledChannels()
// undefined og slår stille og roligt kanalen fra.
//
// Den er en STRENGLITERAL og ikke bygget med .join() over registret, selv om
// det ville være mindre at holde i sync: supabase-js udleder rækketypen ved at
// parse select-strengen på TYPEniveau, og en streng der først findes på runtime
// giver en ParserError-type i stedet for en række — så forsvinder
// felt-typningen på hele svaret. Testen nedenfor fanger det, hvis de to
// kommer ud af trit.
export const CHANNEL_TOGGLE_COLUMNS =
  'notify_email_enabled, notify_sms_enabled, notify_teams_enabled, notify_slack_enabled'

// Kanalernes øvrige pr.-kunde-valg på companies (ikke til/fra, derfor uden for
// vagten nedenfor). Hentes sammen med til/fra-kolonnerne alle de steder
// recipientFor() kaldes — mangler kolonnen, ser Slack `undefined` og slår
// stille og roligt e-mail-opslaget fra.
export const CHANNEL_OPTION_COLUMNS = 'slack_lookup_by_email'

// Vagt mod at literalen og registret divergerer: rækkefølge og indhold skal
// svare til CHANNELS. Kaster ved modulindlæsning (altså ved første kald af
// funktionen efter deploy), ikke stille og roligt ved den enkelte afsendelse.
{
  const derived = CHANNELS.map((c) => CHANNEL_SPEC[c].toggle).join(', ')
  if (derived !== CHANNEL_TOGGLE_COLUMNS) {
    throw new Error(
      `CHANNEL_TOGGLE_COLUMNS er ude af trit med CHANNELS: forventede "${derived}"`,
    )
  }
}

// Skabelonnøgle for en kanal ud fra basisnøglen ('package_arrival',
// 'package_arrival_batch', 'package_status', …).
export function templateKeyFor(channel: Channel, base: string): string {
  return `${base}${CHANNEL_SPEC[channel].templateSuffix}`
}

// Alle skabelonnøgler for et sæt basisnøgler på tværs af kanaler — dispatcheren
// henter dem i ét opslag.
export function allTemplateKeys(bases: string[]): string[] {
  return bases.flatMap((base) => CHANNELS.map((c) => templateKeyFor(c, base)))
}

export function recipientFor(
  channel: Channel,
  emp: ChannelRecipient,
  company: ChannelSettings | null | undefined,
): string | null {
  const v = CHANNEL_SPEC[channel].recipient(emp, company ?? {})
  const s = (v ?? '').trim()
  return s || null
}

// Render en skabelon til den form kanalen sender. E-mail escaper tokenværdier
// og bliver til HTML; de øvrige er ren tekst. Titlen renderes altid (tom for
// alt andet end e-mail), så kalderen ikke skal kende forskellen.
export function renderFor(
  channel: Channel,
  title: string,
  body: string,
  tokens: Record<string, string>,
): { title: string; body: string } {
  const spec = CHANNEL_SPEC[channel]
  return {
    title: render(title, tokens),
    body: spec.format === 'html' ? renderHtml(body, tokens) : render(body, tokens),
  }
}

export function sendVia(
  channel: Channel,
  to: string,
  rendered: { title: string; body: string },
  ctx: SendContext,
): Promise<SendResult> {
  return CHANNEL_SPEC[channel].send(to, rendered.title, rendered.body, ctx)
}

// Hvilke kanaler er aktive for en virksomhed? Virksomhedens override vinder
// over platformens standard (null = arv), og kanaler med et tilvalg kræver at
// kunden har det. Rækkefølgen følger CHANNELS, så loggen bliver forudsigelig.
/**
 * Kanaler kunden har SLÅET TIL, uden hensyn til tilvalg. Forskellen mellem
 * denne og enabledChannels er præcis "valgt, men mangler tilvalget" — og den
 * skelnen skal frem til brugeren, ellers ligner et manglende tilvalg en
 * glemt afkrydsning og sender manageren hen på den forkerte side.
 */
export function selectedChannels(
  company: ChannelSettings | null | undefined,
  platform: ChannelSettings,
): Channel[] {
  return AVAILABLE_CHANNELS.filter((c) => {
    const spec = CHANNEL_SPEC[c]
    return ((company?.[spec.toggle] ?? platform[spec.toggle]) === true)
  })
}

export function enabledChannels(
  company: ChannelSettings | null | undefined,
  platform: ChannelSettings,
  features: Set<string>,
): Channel[] {
  return AVAILABLE_CHANNELS.filter((c) => {
    const spec = CHANNEL_SPEC[c]
    const own = company?.[spec.toggle]
    const on = (own ?? platform[spec.toggle]) === true
    if (!on) return false
    return spec.feature ? features.has(spec.feature) : true
  })
}

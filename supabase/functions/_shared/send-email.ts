// Fælles: send en (allerede renderet) e-mail — uafhængigt af hvilken udbyder
// platformen er sat op med.
//
// To udbydere, ét kald. Valget står i platform_settings.email_provider og
// skiftes på Operia → Integrationer → E-mail:
//   • resend — Resend (Plus Five Five, Inc., US). Nøgle: edge-secret
//     RESEND_API_KEY. Den oprindelige udbyder; bevidst bevaret som fallback.
//   • brevo  — Brevo (Sendinblue SAS, Paris). Nøgle: platform_secrets
//     ['brevo_api_key'], indtastet i UI'et (kan også stå som edge-secret
//     BREVO_API_KEY). EU-hostet — se docs/gdpr/subprocessors.md §5.
//     ADVARSEL: Brevo omskriver alle links til klik-sporing og det kan IKKE
//     slås fra på transaktionsmail. Se ahasend nedenfor.
//   • ahasend — AhaSend (TakTek GmbH, Wien). Nøgle: platform_secrets
//     ['ahasend_api_key'] + et account_id i platform_settings. EU-hostet, og
//     sporing er slået fra som standard — vi slår den desuden eksplicit fra
//     pr. besked, så en kontoindstilling ikke kan komme til at wrappe et
//     nulstillingslink.
//
// Konfigurationen slås op med service-role-klienten og caches i ISOLATET i et
// minut: en dispatcher-kørsel sender mange mails, og de skal ikke koste hver
// sin forespørgsel. Et udbyderskift slår derfor igennem inden for ~1 minut.
//
// Går opslaget galt (DB nede, ingen service-nøgle), falder vi tilbage på
// edge-secrets alene — så en databasefejl ikke også lukker for e-mailen.
//
// Returformen ({ ok, error?, id? }) er uændret, så kanalregistret,
// dispatcherne og notify.ts' classifySendError virker som før. `id` er
// udbyderens besked-id og gemmes som provider_id, så bounce-webhooken
// (resend-webhook / brevo-webhook) kan matche udfaldet tilbage på beskeden.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { brevoApiKey } from './brevo.ts'
import { platformSecret } from './platform-secret.ts'

// Reserveafsenderen er verificeret hos RESEND — og kun dér. Hos Brevo/AhaSend
// ville den give et 201 fra API'et og en stille frasortering bagefter, så for
// de udbydere er en tom afsender en konfigurationsfejl, ikke et fallback.
const DEFAULT_FROM = 'Operia <noreply@predictioninstitute.com>'
const defaultFrom = (provider: MailProvider) => (provider === 'resend' ? DEFAULT_FROM : '')

export type MailProvider = 'resend' | 'brevo' | 'ahasend'

export type MailResult = {
  ok: boolean
  error?: string
  id?: string
  /** Hvilken udbyder der sendte — gemmes sammen med id'et, så et bounce-event
   *  kan matches tilbage til beskeden uanset hvem der stod for leveringen. */
  provider?: MailProvider
  /** Forbigående fejl (rate limit, 5xx, netværk) — kalderen må prøve igen. */
  retryable?: boolean
}

export type MailConfig = {
  provider: MailProvider
  apiKey: string | null
  /** Tom streng = ingen afsender sat (kun muligt for brevo/ahasend). */
  from: string
  /** Kun AhaSend: kontoens UUID, som indgår i send-URL'en. */
  accountId?: string | null
}

const CACHE_TTL_MS = 60_000
let cached: { at: number; cfg: MailConfig } | null = null
let serviceClient: SupabaseClient | null = null

function admin(): SupabaseClient | null {
  if (serviceClient) return serviceClient
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  serviceClient = createClient(url, key, { auth: { persistSession: false } })
  return serviceClient
}

const ENV_KEY: Record<MailProvider, { key: string; from: string }> = {
  resend: { key: 'RESEND_API_KEY', from: 'RESEND_FROM' },
  brevo: { key: 'BREVO_API_KEY', from: 'BREVO_FROM' },
  ahasend: { key: 'AHASEND_API_KEY', from: 'AHASEND_FROM' },
}

function asProvider(value: unknown): MailProvider {
  return value === 'brevo' || value === 'ahasend' ? value : 'resend'
}

/** Rent env-baseret konfiguration — bruges før DB-opslaget og som fallback. */
function envConfig(): MailConfig {
  const provider = asProvider(Deno.env.get('EMAIL_PROVIDER'))
  const env = ENV_KEY[provider]
  return {
    provider,
    apiKey: Deno.env.get(env.key) ?? null,
    from: (Deno.env.get(env.from) ?? '').trim() || defaultFrom(provider),
    accountId: Deno.env.get('AHASEND_ACCOUNT_ID') ?? null,
  }
}

/**
 * Den aktuelle udbyderkonfiguration. Eksporteret, så mail-config-funktionen
 * kan vise hvad der faktisk er i brug uden at duplikere opslaget.
 */
export async function mailConfig(): Promise<MailConfig> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.cfg

  const fallback = envConfig()
  const db = admin()
  if (!db) return fallback

  try {
    const { data: settings } = await db
      .from('platform_settings')
      .select('email_provider, email_from, ahasend_account_id')
      .limit(1)
      .maybeSingle()
    if (!settings) return fallback

    const provider = asProvider(settings.email_provider)
    // Nøglerne indtastes i UI'et (platform_secrets); edge-secrets er kun
    // reservespor til lokal kørsel. Resend er undtagelsen: dens nøgle har altid
    // været en edge-secret og bliver liggende der.
    const apiKey = provider === 'brevo'
      ? await brevoApiKey(db)
      : provider === 'ahasend'
        ? await platformSecret(db, 'ahasend_api_key')
        : Deno.env.get('RESEND_API_KEY') ?? null

    const envFrom = Deno.env.get(ENV_KEY[provider].from)
    const cfg: MailConfig = {
      provider,
      apiKey,
      from: (settings.email_from ?? '').trim() || (envFrom ?? '').trim() || defaultFrom(provider),
      accountId: (settings.ahasend_account_id ?? '').trim() || Deno.env.get('AHASEND_ACCOUNT_ID') || null,
    }
    cached = { at: Date.now(), cfg }
    return cfg
  } catch (err) {
    console.error('mailConfig-opslag fejlede, falder tilbage på edge-secrets:', err)
    return fallback
  }
}

/** Tømmer cachen — kaldes når udbyder/nøgle ændres, så skiftet slår igennem straks. */
export function resetMailConfigCache() {
  cached = null
}

/** "Operia <noreply@x.dk>" → { name, email }; en bar adresse giver name = ''. */
export function parseFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].replace(/^"|"$/g, '').trim(), email: m[2].trim() }
  return { name: '', email: from.trim() }
}

// Forbigående fejl: rate limit og udbyderens egne 5xx. Alt andet (400 ugyldig
// modtager, 401 død nøgle) er permanent og skal logges som fejl.
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function sendViaResend(cfg: MailConfig, to: string, subject: string, html: string): Promise<MailResult> {
  let res: Response
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to, subject, html }),
    })
  } catch (err) {
    return { ok: false, error: `resend_network: ${String(err).slice(0, 200)}`, retryable: true }
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return {
      ok: false,
      error: `resend_${res.status}: ${detail.slice(0, 300)}`,
      retryable: isRetryableStatus(res.status),
    }
  }
  let id: string | undefined
  try {
    const data = await res.json()
    if (data?.id != null) id = String(data.id)
  } catch {
    // Intet/ikke-JSON svar — ignorér.
  }
  return { ok: true, id }
}

async function sendViaBrevo(cfg: MailConfig, to: string, subject: string, html: string): Promise<MailResult> {
  const sender = parseFrom(cfg.from)
  let res: Response
  try {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': cfg.apiKey!,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        // Brevo kræver et navn på højst 70 tegn og en VERIFICERET afsender.
        sender: sender.name ? { name: sender.name.slice(0, 70), email: sender.email } : { email: sender.email },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    })
  } catch (err) {
    return { ok: false, error: `brevo_network: ${String(err).slice(0, 200)}`, retryable: true }
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return {
      ok: false,
      error: `brevo_${res.status}: ${detail.slice(0, 300)}`,
      retryable: isRetryableStatus(res.status),
    }
  }
  // 201 { "messageId": "<2026…@smtp-relay.mailin.fr>" } — gemmes råt, fordi
  // webhooken sender præcis samme streng i feltet "message-id".
  let id: string | undefined
  try {
    const data = await res.json()
    const raw = data?.messageId ?? data?.messageIds?.[0]
    if (raw != null) id = String(raw)
  } catch {
    // Intet/ikke-JSON svar — ignorér.
  }
  return { ok: true, id }
}

async function sendViaAhaSend(cfg: MailConfig, to: string, subject: string, html: string): Promise<MailResult> {
  if (!cfg.accountId) return { ok: false, error: 'ahasend_no_account_id' }
  const from = parseFrom(cfg.from)
  let res: Response
  try {
    res = await fetch(`https://api.ahasend.com/v2/accounts/${cfg.accountId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        from: from.name ? { email: from.email, name: from.name } : { email: from.email },
        recipients: [{ email: to }],
        subject,
        html_content: html,
        // Sporing slås EKSPLICIT fra pr. besked. AhaSend har den fra som
        // standard, men kontoindstillingen kan slå den til for alt — og et
        // omskrevet link i en adgangskode-nulstilling er præcis den fælde vi
        // forlod Brevo for: linket er engangs, så en mailscanner der følger
        // det wrappede link bruger tokenet op. Headerne pr. besked vinder over
        // kontoens indstilling, og AhaSend fjerner dem før levering.
        headers: {
          'ahasend-track-opens': 'false',
          'ahasend-track-clicks': 'false',
        },
      }),
    })
  } catch (err) {
    return { ok: false, error: `ahasend_network: ${String(err).slice(0, 200)}`, retryable: true }
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return {
      ok: false,
      error: `ahasend_${res.status}: ${detail.slice(0, 300)}`,
      retryable: isRetryableStatus(res.status),
    }
  }
  // 202 { object:"list", data:[{ id, recipient, status:"queued", error }] }.
  // Svaret er en LISTE pr. modtager, og en enkelt modtager kan være afvist selv
  // om kaldet er 202 — derfor læses status/error på rækken og ikke kun HTTP-koden.
  try {
    const data = await res.json()
    const row = data?.data?.[0]
    if (row?.error) {
      return { ok: false, error: `ahasend_rejected: ${String(row.error).slice(0, 300)}` }
    }
    const id = row?.id != null ? String(row.id) : undefined
    return { ok: true, id }
  } catch {
    // 2xx uden brugbart svar — beskeden er accepteret, vi har bare intet id.
    return { ok: true }
  }
}

export async function sendEmail(to: string, subject: string, html: string): Promise<MailResult> {
  const cfg = await mailConfig()
  if (!cfg.apiKey) return { ok: false, error: `${cfg.provider}_not_configured` }
  if (!cfg.from) return { ok: false, error: `${cfg.provider}_sender_not_configured` }
  const result = cfg.provider === 'brevo'
    ? await sendViaBrevo(cfg, to, subject, html)
    : cfg.provider === 'ahasend'
      ? await sendViaAhaSend(cfg, to, subject, html)
      : await sendViaResend(cfg, to, subject, html)
  return { ...result, provider: cfg.provider }
}

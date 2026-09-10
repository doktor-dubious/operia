// Fælles katalog for e-mail-integrationen (Operia → Integrationer → E-mail).
// Nøglerne skal matche check-constraints i migrationen
// 20260908140000_brevo_email_provider.sql og udbyderlogikken i edge-funktionerne
// _shared/send-email.ts og email-inbound — en værdi der kun findes her, afvises
// af databasen/serveren.
//
// To ender, to valg: den UDGÅENDE udbyder (invitationer, nulstillinger,
// notifikationer) og den INDGÅENDE (Flow 0's e-mail-kanal, hvor kundens HR-
// system mailer en CSV). De kan skiftes hver for sig — den indgående kræver en
// ændring af MX-posten og følger derfor ikke automatisk den udgående.
//
// `outsideEu` driver GDPR-noten i UI'et: Brevo (Sendinblue SAS, Paris) er den
// eneste af de tre der behandler i EU/EØS, og er derfor det der skal til for en
// "kun EU"-opsætning — se docs/gdpr/subprocessors.md §5.

export type MailProviderKey = 'resend' | 'brevo' | 'ahasend'
export type InboundProviderKey = 'postmark' | 'brevo'

type ProviderBase = {
  /** Udbydernavne er egennavne — ens på alle sprog, derfor ingen i18n-nøgle. */
  label: string
  /** Den juridiske enhed mailen går igennem, og hvor den ligger. */
  vendor: string
  /** i18n-nøgle under `mailPage.country`. */
  country: 'us' | 'fr' | 'at'
  outsideEu: boolean
  /** Hjælpelink til udbyderens egen opsætning. */
  docsUrl: string
}

export type MailProvider = ProviderBase & {
  key: MailProviderKey
  /**
   * Sættes API-nøglen i UI'et (platform_secrets via edge-funktionen
   * mail-config), eller er den en edge-secret sat fra CLI'en? Resend er
   * bevidst det sidste: den var her først, og nøglen bliver liggende som
   * fallback uden at skulle flyttes.
   */
  keyInUi: boolean
  /** Kræver udbyderen et konto-id ved siden af nøglen? (AhaSend gør.) */
  needsAccountId?: boolean
  /**
   * Omskriver udbyderen links i mailen til klik-sporing, og kan det slås fra?
   * Afgørende for konto-mails: et nulstillingslink er ENGANGS, så en
   * mailscanner der følger et wrappet link kan bruge tokenet op. Vises som en
   * advarsel i UI'et, så valget træffes med åbne øjne.
   *   'no'       — sporing er fra (eller fravalgt af os) og links røres ikke
   *   'forced'   — udbyderen omskriver links og det kan IKKE fravælges
   */
  linkTracking: 'no' | 'forced'
  /** Hvor nøglen hentes hos udbyderen — hjælpelink ved siden af feltet. */
  keyUrl?: string
}

export type InboundProvider = ProviderBase & {
  key: InboundProviderKey
  /** MX-posterne der skal stå på modtagedomænet — vises som opsætningshjælp. */
  mx: { priority: number; host: string }[]
}

export const MAIL_PROVIDERS: MailProvider[] = [
  {
    key: 'resend',
    label: 'Resend',
    vendor: 'Plus Five Five, Inc.',
    country: 'us',
    outsideEu: true,
    docsUrl: 'https://resend.com/docs',
    keyInUi: false,
    // Resend har åbning/klik SLÅET FRA som standard pr. domæne, og selv slået
    // til bruger den et underdomæne af kundens eget domæne.
    linkTracking: 'no',
  },
  {
    key: 'brevo',
    label: 'Brevo',
    vendor: 'Sendinblue SAS',
    country: 'fr',
    outsideEu: false,
    docsUrl: 'https://developers.brevo.com/docs/send-a-transactional-email',
    keyInUi: true,
    keyUrl: 'https://app.brevo.com/settings/keys/api',
    // Brevo omskriver ALLE links til *.sendibt3.com og det kan ikke fravælges
    // på transaktionsmail (kun anonymiseres). Konstateret i drift 2026-09-08.
    linkTracking: 'forced',
  },
  {
    key: 'ahasend',
    label: 'AhaSend',
    vendor: 'TakTek GmbH',
    country: 'at',
    outsideEu: false,
    docsUrl: 'https://ahasend.com/docs/api-reference/messages/create-message',
    keyInUi: true,
    keyUrl: 'https://dash.ahasend.com',
    needsAccountId: true,
    // Sporing er fra som standard, og vi slår den desuden fra pr. besked med
    // ahasend-track-opens/-clicks, så en kontoindstilling ikke kan wrappe et
    // nulstillingslink. Se supabase/functions/_shared/send-email.ts.
    linkTracking: 'no',
  },
]

export const INBOUND_PROVIDERS: InboundProvider[] = [
  {
    key: 'postmark',
    label: 'Postmark',
    vendor: 'ActiveCampaign, LLC',
    country: 'us',
    outsideEu: true,
    docsUrl: 'https://postmarkapp.com/manual#inbound-processing',
    mx: [{ priority: 10, host: 'inbound.postmarkapp.com' }],
  },
  {
    key: 'brevo',
    label: 'Brevo',
    vendor: 'Sendinblue SAS',
    country: 'fr',
    outsideEu: false,
    docsUrl: 'https://developers.brevo.com/docs/inbound-parse-webhooks',
    mx: [
      { priority: 10, host: 'inbound1.sendinblue.com' },
      { priority: 20, host: 'inbound2.sendinblue.com' },
    ],
  },
]

export const MAIL_PROVIDER_KEYS = MAIL_PROVIDERS.map((p) => p.key)
export const INBOUND_PROVIDER_KEYS = INBOUND_PROVIDERS.map((p) => p.key)

export function mailProvider(key: string | null | undefined): MailProvider | null {
  return MAIL_PROVIDERS.find((p) => p.key === key) ?? null
}

export function inboundProvider(key: string | null | undefined): InboundProvider | null {
  return INBOUND_PROVIDERS.find((p) => p.key === key) ?? null
}

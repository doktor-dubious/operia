// Indgående e-mail: udbydernes nyttelast → én fælles form.
//
// email-inbound tager imod BEGGE udbydere samtidig, så MX-posten kan lægges om
// uden nedetid. Forskellene ligger alene her:
//   • Postmark sender ét objekt med vedhæftningerne base64-kodet MED i JSON'en
//     og headerne som en liste af {Name, Value}.
//   • Brevo sender et `items`-array, headerne som et opslag, og vedhæftningerne
//     kun som DownloadToken — indholdet skal hentes med et API-kald.
// Resten af funktionen (afsenderverifikation, allowlist, import) kender kun
// InboundMessage og mærker derfor ikke forskellen.

import { decodeBase64 } from 'jsr:@std/encoding@1/base64'
import { fetchInboundAttachment } from './brevo.ts'

// ---------------------------------------------------------------------------
// Udbydernes nyttelast + den fælles form resten af funktionen arbejder på
// ---------------------------------------------------------------------------

// Postmark inbound webhook (delmængde af felterne vi bruger).
type PostmarkAttachment = { Name?: string; Content?: string; ContentType?: string }
export type PostmarkHeader = { Name?: string; Value?: string }
export type PostmarkInbound = {
  MessageID?: string
  OriginalRecipient?: string
  ToFull?: { Email?: string }[]
  From?: string
  FromFull?: { Email?: string }
  Attachments?: PostmarkAttachment[]
  Headers?: PostmarkHeader[]
}

// Brevo inbound parsing (delmængde). Adresser kommer som {Address, Name};
// ældre/andre varianter sender dem som rene strenge, så begge accepteres.
type BrevoMailbox = { Address?: string; Name?: string } | string
type BrevoAttachment = {
  Name?: string
  ContentType?: string
  ContentID?: string
  ContentLength?: number
  DownloadToken?: string
}
type BrevoInboundItem = {
  MessageId?: string
  From?: BrevoMailbox
  To?: BrevoMailbox[]
  Recipients?: BrevoMailbox[]
  Subject?: string
  Attachments?: BrevoAttachment[]
  // Komplette mail-headere: én værdi som streng, flere som array.
  Headers?: Record<string, string | string[]>
}
export type BrevoInbound = { items?: BrevoInboundItem[] }

/** Den form resten af funktionen kender — uafhængig af udbyder. */
export type InboundAttachment = {
  name: string | null
  contentType: string | null
  /** Henter bytes (Postmark: base64-afkodning; Brevo: et API-kald). */
  bytes: () => Promise<Uint8Array>
}
export type InboundMessage = {
  messageId: string | null
  /** Envelope-modtageren, rå ("Navn <nordwind@…>" accepteres). */
  recipient: string
  from: string
  headers: PostmarkHeader[]
  attachments: InboundAttachment[]
}

export function normalizePostmark(body: PostmarkInbound): InboundMessage[] {
  return [
    {
      messageId: body.MessageID ?? null,
      // OriginalRecipient er den adresse mailen faktisk blev leveret til;
      // falder tilbage til To-headeren.
      recipient: String(body.OriginalRecipient ?? body.ToFull?.[0]?.Email ?? ''),
      from: String(body.FromFull?.Email ?? body.From ?? ''),
      headers: body.Headers ?? [],
      attachments: (body.Attachments ?? []).map((a) => ({
        name: a.Name ?? null,
        contentType: a.ContentType ?? null,
        bytes: () => {
          // Postmark sender indholdet med i nyttelasten, base64-kodet.
          if (!a.Content) throw new Error('empty_attachment')
          return Promise.resolve(decodeBase64(a.Content))
        },
      })),
    },
  ]
}

function mailboxAddress(m: BrevoMailbox | undefined): string {
  if (!m) return ''
  return typeof m === 'string' ? m : String(m.Address ?? '')
}

// Brevo leverer headerne som et opslag (én værdi = streng, flere = array);
// parseAuthHeaders vil have par, og et gentaget Authentication-Results SKAL
// bevares som flere par — ellers falder "dårligst-af"-reglen fra hinanden.
function brevoHeaders(headers: Record<string, string | string[]> | undefined): PostmarkHeader[] {
  const out: PostmarkHeader[] = []
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value)) for (const v of value) out.push({ Name: name, Value: String(v) })
    else out.push({ Name: name, Value: String(value) })
  }
  return out
}

export function normalizeBrevo(body: BrevoInbound, apiKey: () => Promise<string>): InboundMessage[] {
  return (body.items ?? []).map((item) => ({
    messageId: item.MessageId ?? null,
    // Recipients = RCPT TO (envelope) og er derfor det nærmeste sidestykke til
    // Postmarks OriginalRecipient; To-headeren er reserven.
    recipient: mailboxAddress(item.Recipients?.[0]) || mailboxAddress(item.To?.[0]),
    from: mailboxAddress(item.From),
    headers: brevoHeaders(item.Headers),
    attachments: (item.Attachments ?? []).map((a) => ({
      name: a.Name ?? null,
      contentType: a.ContentType ?? null,
      bytes: async () => {
        if (!a.DownloadToken) throw new Error('missing_download_token')
        return await fetchInboundAttachment(await apiKey(), a.DownloadToken)
      },
    })),
  }))
}


/**
 * Formen afgør udbyderen: Brevo sender et items-array, Postmark ét objekt.
 * `apiKey` hentes dovent — en Postmark-levering rører den aldrig.
 */
export function normalizeInbound(
  raw: PostmarkInbound & BrevoInbound,
  apiKey: () => Promise<string>,
): InboundMessage[] {
  return Array.isArray(raw.items) ? normalizeBrevo(raw, apiKey) : normalizePostmark(raw)
}

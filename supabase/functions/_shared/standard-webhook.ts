// Standard Webhooks-signatur ét sted (https://www.standardwebhooks.com).
//
// Både Resend (via Svix) og AhaSend signerer efter samme opskrift: HMAC-SHA256
// over "{id}.{timestamp}.{body}", resultatet base64-kodet, og headeren kan bære
// flere signaturer adskilt af mellemrum som "v1,<sig>" (nøglerotation).
//
// MEN de er UENIGE om hvordan hemmeligheden bliver til en nøgle, og det er en
// stille fælde — en forkert nøgle giver ikke en fejl, bare en signatur der
// aldrig matcher, altså en webhook der tavst afviser alt:
//   • Svix/Resend: hemmeligheden er base64 MED præfikset "whsec_" foran, som
//     skal fjernes, og resten base64-DEKODES til nøglebytes.
//   • AhaSend: hemmeligheden bruges som RÅ UTF-8-bytes, præfiks og det hele.
//     AhaSends egen dokumentation advarer eksplicit om at Standard
//     Webhooks-bibliotekerne som standard base64-dekoder og dermed fejler.
//
// Derfor er `keyMode` et påkrævet argument: den der tilslutter en ny udbyder
// SKAL tage stilling, i stedet for at arve en default der passer til den anden.

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export type StandardWebhookInput = {
  secret: string
  id: string
  timestamp: string
  /** Hele webhook-signature-headeren, fx "v1,abc== v1,def==". */
  signatureHeader: string
  /** Den RÅ body-tekst — må ikke være genserialiseret JSON. */
  body: string
  /**
   * Hvordan hemmeligheden bliver til nøglebytes.
   *   'svix' → fjern "whsec_"-præfiks og base64-dekodér (Resend)
   *   'raw'  → brug hemmeligheden som UTF-8-bytes, præfiks og alt (AhaSend)
   */
  keyMode: 'svix' | 'raw'
  /** Replay-vindue i sekunder (default ±5 min). */
  toleranceSeconds?: number
}

export async function verifyStandardWebhook({
  secret,
  id,
  timestamp,
  signatureHeader,
  body,
  keyMode,
  toleranceSeconds = 300,
}: StandardWebhookInput): Promise<boolean> {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false

  const keyBytes = keyMode === 'svix'
    ? base64ToBytes(secret.replace(/^whsec_/, ''))
    : new TextEncoder().encode(secret)

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  )
  const expected = bytesToBase64(mac)

  for (const part of signatureHeader.split(' ')) {
    const value = part.split(',')[1]
    if (value && timingSafeEqual(value, expected)) return true
  }
  return false
}

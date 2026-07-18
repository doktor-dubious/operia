// Fælles: send SMS via GatewayAPI (gatewayapi.com, dansk udbyder).
//
// Bruger den simple Token-godkendelse: header "Authorization: Token <token>".
// Tokenet ligger i edge-secret GATEWAYAPI_TOKEN (aldrig i klienten/repoet, jf.
// RESEND_API_KEY-mønstret). Afsender-id kommer fra GATEWAYAPI_SENDER (default
// 'Operia'); et alfanumerisk afsender-id må højst være 11 tegn og skal være
// registreret i det danske afsender-id-register for ikke at blive blokeret.
//
// Samme form som invite-email.ts: returnerer { ok, error? } så kalderen (senere
// påmindelses-dispatcheren) kan logge resultatet i beskeds-/leveringsloggen.

const GATEWAYAPI_URL = 'https://messaging.gatewayapi.com/mobile/single'
const DEFAULT_SENDER = 'Operia'

// Normalisér et telefonnummer til et MSISDN (landekode + nummer, kun cifre).
// GatewayAPI vil have modtageren som et tal, fx 4512345678 — uden '+' eller '00'.
//
// Uden en landekode kan et nummer ikke sendes korrekt: GatewayAPI læser de
// forreste cifre som landekode, så "12345678" ryger et forkert sted hen (eller i
// tomrummet) mens API'et svarer "sendt". Derfor:
//   • et rent 8-cifret nummer antages at være dansk og får 45 foran (DK-first);
//   • ellers KRÆVES landekode — resultatet skal være 9–15 cifre (E.164), ellers
//     returneres null, så en fejlkonfiguration fanges frem for at "lykkes" tomt.
//     Nedre grænse er 9 (ikke 10), så gyldige 9-cifrede numre som Grønland
//     (+299 XXXXXX) og Færøerne (+298 XXXXXX) — relevante for en dansk lejer —
//     ikke afvises.
// Udenlandske medarbejdere skal derfor gemmes MED landekode (>8 cifre); det er
// import-/indtastningssidens ansvar.
export function toMsisdn(phone: string | number, defaultCc = '45'): number | null {
  let digits = String(phone).replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2) // internationalt 00-præfiks
  if (digits.length === 8) digits = defaultCc + digits // bart dansk nummer
  if (digits.length < 9 || digits.length > 15) return null
  const n = Number(digits)
  return Number.isSafeInteger(n) ? n : null
}

export async function sendSms(
  phone: string | number,
  message: string,
  opts: { sender?: string } = {},
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const token = Deno.env.get('GATEWAYAPI_TOKEN')
  if (!token) return { ok: false, error: 'gatewayapi_not_configured' }

  const recipient = toMsisdn(phone)
  if (recipient === null) return { ok: false, error: 'invalid_recipient' }

  const sender = (opts.sender ?? Deno.env.get('GATEWAYAPI_SENDER') ?? DEFAULT_SENDER).slice(0, 11)

  let res: Response
  try {
    res = await fetch(GATEWAYAPI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sender, message, recipient }),
    })
  } catch (err) {
    // Netværksfejl mod GatewayAPI (DNS, timeout …).
    return { ok: false, error: `gatewayapi_network: ${String(err).slice(0, 200)}` }
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, error: `gatewayapi_${res.status}: ${detail.slice(0, 300)}` }
  }

  // Svaret er fx {"msg_id":"01KXR…","recipient":4512345678,"reference":null}.
  // Vi læser besked-id'et defensivt til loggen, men afsendelsen er lykkedes
  // uanset svarets form (2xx).
  let id: string | undefined
  try {
    const data = await res.json()
    const raw = data?.msg_id ?? data?.id ?? data?.ids?.[0] ?? data?.message_id
    if (raw != null) id = String(raw)
  } catch {
    // Intet/ikke-JSON svar — ignorér.
  }
  return { ok: true, id }
}

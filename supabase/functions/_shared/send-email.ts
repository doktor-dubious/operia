// Fælles: send en (allerede renderet) e-mail via Resend. Generel udgave af
// mønstret fra invite-email.ts — invitationen har sin egen skabelon-logik, mens
// denne bare tager færdigt emne + HTML og sender. Bruges af pakke-notifikations-
// dispatcheren. Nøgle + afsender fra edge-secrets (RESEND_API_KEY, RESEND_FROM).

const DEFAULT_FROM = 'Operia <noreply@predictioninstitute.com>'

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return { ok: false, error: 'resend_not_configured' }
  const from = Deno.env.get('RESEND_FROM') ?? DEFAULT_FROM

  let res: Response
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    })
  } catch (err) {
    return { ok: false, error: `resend_network: ${String(err).slice(0, 200)}` }
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, error: `resend_${res.status}: ${detail.slice(0, 300)}` }
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

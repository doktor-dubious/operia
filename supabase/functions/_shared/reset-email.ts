// Fælles: send "nulstil adgangskode"-e-mail med platformens skabelon.
//
// Skabelonen redigeres på Operia → Skabeloner (platform_templates, nøgle
// 'password_reset'). Titel = emne, Brødtekst = HTML. Tokenet {{link}} i
// brødteksten erstattes med nulstillingslinket; mangler det, tilføjes en knap.
// Selve afsendelsen går gennem sendEmail, så mailen følger platformens
// udbydervalg (Resend eller Brevo) — se send-email.ts.
// Sidestykke til invite-email.ts — hold de to i sync.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { sendEmail } from './send-email.ts'

const DEFAULT_SUBJECT = 'Nulstil din Operia-adgangskode'
const DEFAULT_BODY =
  'Vi har modtaget en anmodning om at nulstille adgangskoden til din Operia-konto. ' +
  'Klik på linket for at vælge en ny adgangskode. Har du ikke bedt om det, kan du ' +
  'roligt ignorere denne e-mail.'

export async function sendResetEmail(
  admin: SupabaseClient,
  email: string,
  actionLink: string,
  lang = 'da',
): Promise<{ ok: boolean; error?: string }> {
  // Vælg skabelonen i modtagerens sprog; fald tilbage til dansk (first).
  const loadTemplate = (l: string) =>
    admin
      .from('platform_templates')
      .select('title, body')
      .eq('key', 'password_reset')
      .eq('lang', l)
      .maybeSingle()

  let { data: tpl } = await loadTemplate(lang)
  if (!tpl && lang !== 'da') ({ data: tpl } = await loadTemplate('da'))

  const subject = tpl?.title?.trim() || DEFAULT_SUBJECT
  let html = tpl?.body?.trim() || DEFAULT_BODY
  // Ren tekst → simpel HTML (bevar linjeskift).
  if (!html.includes('<')) html = html.replace(/\n/g, '<br>')
  // Indsæt nulstillingslinket.
  if (html.includes('{{link}}')) {
    html = html.replaceAll('{{link}}', actionLink)
  } else {
    html += `<p style="margin-top:20px"><a href="${actionLink}">Nulstil adgangskode</a></p>`
  }

  const sent = await sendEmail(email, subject, html)

  // Gem udbyderens besked-id, så et bounce-event senere kan findes tilbage til
  // denne mail (se _shared/mail-events.ts). Best-effort: en fejl her må aldrig
  // gøre en afsendt mail til en fejlet.
  if (sent.ok && sent.id) {
    const { error: recErr } = await admin.rpc('record_account_email', {
      p_kind: 'password_reset',
      p_provider: sent.provider ?? 'resend',
      p_provider_id: sent.id,
      p_email: email,
    })
    if (recErr) console.error('record_account_email fejlede:', recErr.message)
  }

  return sent.ok ? { ok: true } : { ok: false, error: sent.error }
}

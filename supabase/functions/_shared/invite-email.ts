// Fælles: send invitations-e-mail med platformens skabelon.
//
// Skabelonen redigeres på Operia → Skabeloner (platform_templates, nøgle
// 'customer_invite'). Titel = emne, Brødtekst = HTML. Tokenet {{link}} i
// brødteksten erstattes med accept-linket; mangler det, tilføjes en knap.
// Selve afsendelsen går gennem sendEmail, så mailen følger platformens
// udbydervalg (Resend eller Brevo) — se send-email.ts.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { sendEmail } from './send-email.ts'

const DEFAULT_SUBJECT = 'Du er blevet inviteret til Operia'
const DEFAULT_BODY =
  'Du er blevet inviteret til at oprette en konto i Operia. Klik på linket for at acceptere invitationen og vælge din adgangskode.'

export async function sendInviteEmail(
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
      .eq('key', 'customer_invite')
      .eq('lang', l)
      .maybeSingle()

  let { data: tpl } = await loadTemplate(lang)
  if (!tpl && lang !== 'da') ({ data: tpl } = await loadTemplate('da'))

  const subject = tpl?.title?.trim() || DEFAULT_SUBJECT
  let html = (tpl?.body?.trim() || DEFAULT_BODY)
  // Ren tekst → simpel HTML (bevar linjeskift).
  if (!html.includes('<')) html = html.replace(/\n/g, '<br>')
  // Indsæt accept-linket.
  if (html.includes('{{link}}')) {
    html = html.replaceAll('{{link}}', actionLink)
  } else {
    html += `<p style="margin-top:20px"><a href="${actionLink}">Accepter invitation</a></p>`
  }

  const sent = await sendEmail(email, subject, html)

  // Gem udbyderens besked-id, så et bounce-event senere kan findes tilbage til
  // denne mail (se _shared/mail-events.ts). Best-effort: en fejl her må aldrig
  // gøre en afsendt mail til en fejlet.
  if (sent.ok && sent.id) {
    const { error: recErr } = await admin.rpc('record_account_email', {
      p_kind: 'invite',
      p_provider: sent.provider ?? 'resend',
      p_provider_id: sent.id,
      p_email: email,
    })
    if (recErr) console.error('record_account_email fejlede:', recErr.message)
  }

  return sent.ok ? { ok: true } : { ok: false, error: sent.error }
}

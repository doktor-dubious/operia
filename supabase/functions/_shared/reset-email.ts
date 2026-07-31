// Fælles: send "nulstil adgangskode"-e-mail via Resend med platformens skabelon.
//
// Skabelonen redigeres på Operia → Skabeloner (platform_templates, nøgle
// 'password_reset'). Titel = emne, Brødtekst = HTML. Tokenet {{link}} i
// brødteksten erstattes med nulstillingslinket; mangler det, tilføjes en knap.
// Nøgle + afsender kommer fra edge-secrets (RESEND_API_KEY, RESEND_FROM).
// Sidestykke til invite-email.ts — hold de to i sync.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const DEFAULT_FROM = 'Operia <noreply@predictioninstitute.com>'
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
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return { ok: false, error: 'resend_not_configured' }
  const from = Deno.env.get('RESEND_FROM') ?? DEFAULT_FROM

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

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: email, subject, html }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    return { ok: false, error: `resend_${res.status}: ${detail.slice(0, 300)}` }
  }
  return { ok: true }
}

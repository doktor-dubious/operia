// slack-oauth — Slacks omdirigering efter at kunden har godkendt installationen.
//
// Kaldes af BROWSEREN, ikke af vores app, og har derfor ingen Supabase-JWT
// (deployes med --no-verify-jwt). Autorisationen er state-nøglen:
//
//   • udstedt af slack-config til en verificeret manager i én bestemt virksomhed
//   • ugættelig (to UUID'er), ENGANGSBRUG (slettes før koden indløses) og
//     gyldig i 10 minutter
//
// Uden den kunne enhver kalde dette endepunkt med en kode fra sit eget workspace
// og binde det til en fremmed virksomhed — derfor slås virksomheden ALDRIG op
// fra en query-parameter, kun fra den gemte state-række.
//
// Svaret er en omdirigering tilbage til appen med et kort udfaldsflag i URL'en;
// selve fejlteksten står i loggen, ikke i adressebaren.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const STATE_TTL_MS = 10 * 60_000

function back(appUrl: string, status: string): Response {
  const target = new URL('/configure/integrations', appUrl.replace(/\/+$/, ''))
  target.searchParams.set('slack', status)
  return new Response(null, { status: 302, headers: { Location: target.toString() } })
}

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  // Samme fallback som invite-user/request-password-reset: uden den ville
  // new URL('/…', '') kaste på HVER udgang — også efter at state-rækken er
  // slettet og engangskoden brugt, så manageren måtte starte forfra.
  const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173'
  const clientId = Deno.env.get('SLACK_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('SLACK_CLIENT_SECRET') ?? ''

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const params = new URL(req.url).searchParams

  // Kunden trykkede "Annullér" i Slack (eller Slack afviste).
  if (params.get('error')) return back(appUrl, 'cancelled')

  const code = params.get('code') ?? ''
  const state = params.get('state') ?? ''
  if (!code || !state) return back(appUrl, 'invalid')
  if (!clientId || !clientSecret) return back(appUrl, 'not_configured')

  // ── Indløs state: find, verificér alder, og SLET før koden bruges ─────────
  const { data: stateRow } = await admin
    .from('slack_oauth_state')
    .select('state, company_id, created_by, created_at')
    .eq('state', state)
    .maybeSingle()

  // Slet uanset udfald (og ryd udløbne): en state må aldrig kunne genbruges,
  // heller ikke hvis token-udvekslingen nedenfor fejler.
  await admin.from('slack_oauth_state').delete().eq('state', state)
  await admin
    .from('slack_oauth_state')
    .delete()
    .lt('created_at', new Date(Date.now() - STATE_TTL_MS).toISOString())

  if (!stateRow) return back(appUrl, 'invalid')
  if (Date.now() - Date.parse(stateRow.created_at as string) > STATE_TTL_MS) {
    return back(appUrl, 'expired')
  }
  const companyId = stateRow.company_id as string

  // ── Byt koden til et bot-token ───────────────────────────────────────────
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: `${url.replace(/\/+$/, '')}/functions/v1/slack-oauth`,
  })

  let res: Response
  try {
    res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
  } catch {
    return back(appUrl, 'network')
  }

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    access_token?: string
    bot_user_id?: string
    team?: { id?: string; name?: string }
  }
  if (!data.ok || !data.access_token) return back(appUrl, 'exchange_failed')

  // ── Gem ──────────────────────────────────────────────────────────────────
  // Konfigurationsrækken skal findes, før triggeren kan spejle token_set.
  const { error: cfgErr } = await admin.from('company_slack_config').upsert(
    {
      company_id: companyId,
      team_id: data.team?.id ?? null,
      team_name: data.team?.name ?? null,
      bot_user_id: data.bot_user_id ?? null,
      connected_at: new Date().toISOString(),
      connected_by: stateRow.created_by,
    },
    { onConflict: 'company_id' },
  )
  if (cfgErr) return back(appUrl, 'save_failed')

  const { error: secErr } = await admin
    .from('company_slack_secret')
    .upsert({ company_id: companyId, bot_token: data.access_token }, { onConflict: 'company_id' })
  if (secErr) return back(appUrl, 'save_failed')

  // Revisionsspor: hvem forbandt hvilket workspace, hvornår. Tokenet indgår
  // aldrig — kun workspacets navn/id, som ikke er en hemmelighed.
  await admin.rpc('record_audit', {
    p_company_id: companyId,
    p_action: 'slack.connected',
    p_entity_type: 'slack_config',
    p_entity_id: companyId,
    p_summary: data.team?.name ?? null,
    p_detail: { team_id: data.team?.id ?? null },
    p_actor: stateRow.created_by,
  })

  return back(appUrl, 'connected')
})

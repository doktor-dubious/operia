// slack-config — starter, tester og afbryder kundens Slack-installation.
//
// Selve token-udvekslingen sker i slack-oauth (som Slack omdirigerer browseren
// til). Denne funktion er den JWT-beskyttede halvdel, som en manager kalder:
//
//   start       → udsteder en engangs-state og returnerer Slacks godkendelses-URL
//   test        → auth.test mod Slack, så man kan se at tokenet stadig virker
//   disconnect  → glemmer token + konfiguration
//
// SIKKERHED (browseren er utroværdig, se CLAUDE.md):
//   • Kalderens rolle genverificeres server-side (callerCanManageCompany).
//   • Integrationen skal være udbudt af platformen (platform_settings.slack_enabled).
//   • Bot-tokenet forlader aldrig serveren — 'test' returnerer kun workspacets
//     navn, aldrig tokenet.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { callerCanManageCompany } from '../_shared/user-admin.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// Kun de rettigheder kanalen faktisk bruger: skriv beskeder, og slå en bruger op
// på e-mail. Flere scopes ville kræve fornyet godkendelse hos alle kunder.
//
// users:read SKAL med: hos Slack er users:read.email ikke et selvstændigt
// scope, men en udvidelse af users:read, og beder man kun om det sidste,
// afvises hele installationen med "Invalid permissions requested".
const SCOPES = 'chat:write,users:read,users:read.email'

type Body = { companyId?: string; action?: 'start' | 'test' | 'disconnect' }

export function redirectUri(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/slack-oauth`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)

  const body = (await req.json().catch(() => ({}))) as Body
  const companyId = body.companyId?.trim()
  const action = body.action
  if (!companyId) return json({ error: 'company_required' }, 400)
  if (!action) return json({ error: 'action_required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  if (!(await callerCanManageCompany(admin, userData.user.id, companyId))) {
    return json({ error: 'forbidden' }, 403)
  }

  const { data: platform } = await admin
    .from('platform_settings')
    .select('slack_enabled')
    .limit(1)
    .maybeSingle()
  // 'disconnect' er undtaget: slår DCA integrationen fra, skal kunden stadig
  // kunne tilbagekalde det gemte token — det er deres workspace.
  if (!platform?.slack_enabled && action !== 'disconnect') {
    return json({ error: 'integration_disabled' }, 403)
  }

  // ── start: udsted state og byg godkendelses-URL'en ────────────────────────
  if (action === 'start') {
    const clientId = Deno.env.get('SLACK_CLIENT_ID')
    if (!clientId) return json({ ok: false, reason: 'not_configured' })

    // Engangsnøgle. crypto.randomUUID er kryptografisk stærk og rigelig her:
    // den skal blot være ugættelig inden for sine 10 minutters levetid.
    const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')

    // Ryd udløbne states samtidig — tabellen skal ikke vokse af afbrudte forsøg.
    await admin
      .from('slack_oauth_state')
      .delete()
      .lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString())

    const { error } = await admin.from('slack_oauth_state').insert({
      state,
      company_id: companyId,
      created_by: userData.user.id,
    })
    if (error) return json({ error: 'state_failed', detail: error.message }, 500)

    const authorize = new URL('https://slack.com/oauth/v2/authorize')
    authorize.searchParams.set('client_id', clientId)
    authorize.searchParams.set('scope', SCOPES)
    authorize.searchParams.set('state', state)
    authorize.searchParams.set('redirect_uri', redirectUri(url))
    return json({ ok: true, url: authorize.toString() })
  }

  // ── disconnect: glem token og forbindelse ─────────────────────────────────
  if (action === 'disconnect') {
    // Tokenet ryddes først: fejler noget bagefter, er det værste udfald en
    // forældet visning — ikke at vi bliver ved med at sende ind i et workspace
    // kunden har afbrudt.
    const { error: secErr } = await admin
      .from('company_slack_secret')
      .upsert({ company_id: companyId, bot_token: null }, { onConflict: 'company_id' })
    if (secErr) return json({ error: 'disconnect_failed', detail: secErr.message }, 500)

    await admin
      .from('company_slack_config')
      .update({ team_id: null, team_name: null, bot_user_id: null, connected_at: null })
      .eq('company_id', companyId)

    await admin.rpc('record_audit', {
      p_company_id: companyId,
      p_action: 'slack.disconnected',
      p_entity_type: 'slack_config',
      p_entity_id: companyId,
      p_summary: null,
      p_detail: {},
      p_actor: userData.user.id,
    })
    return json({ ok: true })
  }

  // ── test: virker tokenet stadig? ──────────────────────────────────────────
  const { data: sec } = await admin
    .from('company_slack_secret')
    .select('bot_token')
    .eq('company_id', companyId)
    .maybeSingle()
  const token = (sec?.bot_token ?? '') as string
  if (!token) return json({ ok: false, reason: 'not_connected' })

  let res: Response
  try {
    res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (err) {
    return json({ ok: false, reason: 'network', detail: String(err).slice(0, 200) })
  }
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    team?: string
    url?: string
  }
  if (!data.ok) return json({ ok: false, reason: data.error ?? 'auth_failed' })
  return json({ ok: true, team: data.team ?? null })
})

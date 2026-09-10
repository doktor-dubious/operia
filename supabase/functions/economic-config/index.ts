// economic-config — skriver og tester regnskabsintegrationens hemmeligheder.
//
// To niveauer, samme funktion:
//   Platform (kun platform-admin):
//     save_app_secret / clear_app_secret → platform_secrets['economic_app_secret_token']
//   Pr. kunde (manager i virksomheden eller platform-admin):
//     save_token / clear_token → company_accounting_secret.access_token
//     test                    → GET /self med begge tokens; gemmer aftalenummer +
//                               firmanavn på konfigurationen som "verificeret"
//
// Hemmelighederne går KUN denne vej: hverken platform_secrets eller
// company_accounting_secret har RLS-politikker eller grants, så de kan ikke
// læses eller skrives gennem PostgREST. Browseren kan sætte en ny værdi og se
// "sat ✓" (spejlet af triggere), men aldrig læse den igen. 'test' returnerer
// aftalenummer og firmanavn — aldrig tokens.
//
// SIKKERHED (browseren er utroværdig, se CLAUDE.md):
//   • Kalderens rolle genverificeres server-side.
//   • Integrationen skal være udbudt af platformen, og udbyderen valgt —
//     undtagen clear_token: slår DCA integrationen fra, skal kunden stadig
//     kunne tilbagekalde sit token (det er deres regnskab).

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { callerCanManageCompany, isPlatformAdmin } from '../_shared/user-admin.ts'
import { economicReason, economicSelf } from '../_shared/economic.ts'

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

const APP_SECRET_KEY = 'economic_app_secret_token'

type Action = 'save_app_secret' | 'clear_app_secret' | 'save_token' | 'clear_token' | 'test'
type Body = { companyId?: string; action?: Action; secret?: string }

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
  const callerId = userData.user.id

  const body = (await req.json().catch(() => ({}))) as Body
  const action = body.action
  if (!action) return json({ error: 'action_required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: platform } = await admin
    .from('platform_settings')
    .select('accounting_enabled, accounting_providers')
    .limit(1)
    .maybeSingle()
  const offered =
    !!platform?.accounting_enabled &&
    ((platform.accounting_providers as string[] | null) ?? []).includes('economic')

  // ── Platform: DCA's AppSecretToken ──────────────────────────────────────
  if (action === 'save_app_secret' || action === 'clear_app_secret') {
    if (!(await isPlatformAdmin(admin, callerId))) return json({ error: 'forbidden' }, 403)
    const secret = action === 'save_app_secret' ? (body.secret ?? '').trim() : ''
    if (action === 'save_app_secret' && !secret) return json({ error: 'secret_required' }, 400)

    const { error } = await admin
      .from('platform_secrets')
      .upsert({ key: APP_SECRET_KEY, value: secret || null, updated_by: callerId }, { onConflict: 'key' })
    if (error) return json({ error: 'save_failed', detail: error.message }, 500)

    const { error: auditErr } = await admin.rpc('record_audit', {
      p_company_id: null,
      p_action: action === 'save_app_secret' ? 'accounting.app_secret_set' : 'accounting.app_secret_cleared',
      p_entity_type: 'platform_settings',
      p_entity_id: 'platform',
      p_summary: null,
      p_detail: { provider: 'economic' },
      p_actor: callerId,
    })
    if (auditErr) console.error('record_audit fejlede:', auditErr.message)
    return json({ ok: true })
  }

  // ── Pr. kunde ───────────────────────────────────────────────────────────
  const companyId = body.companyId?.trim()
  if (!companyId) return json({ error: 'company_required' }, 400)
  if (!(await callerCanManageCompany(admin, callerId, companyId))) {
    return json({ error: 'forbidden' }, 403)
  }
  if (!offered && action !== 'clear_token') return json({ error: 'integration_disabled' }, 403)

  if (action === 'save_token' || action === 'clear_token') {
    const secret = action === 'save_token' ? (body.secret ?? '').trim() : ''
    if (action === 'save_token' && !secret) return json({ error: 'secret_required' }, 400)

    // Konfigurationsrækken skal findes, før triggeren kan spejle "sat"-flaget.
    const { error: cfgError } = await admin
      .from('company_accounting_config')
      .upsert({ company_id: companyId }, { onConflict: 'company_id', ignoreDuplicates: true })
    if (cfgError) return json({ error: 'save_failed', detail: cfgError.message }, 500)

    const { error } = await admin
      .from('company_accounting_secret')
      .upsert({ company_id: companyId, access_token: secret || null }, { onConflict: 'company_id' })
    if (error) return json({ error: 'save_failed', detail: error.message }, 500)

    const { error: auditErr } = await admin.rpc('record_audit', {
      p_company_id: companyId,
      p_action: action === 'save_token' ? 'accounting.secret_set' : 'accounting.secret_cleared',
      p_entity_type: 'accounting_config',
      p_entity_id: companyId,
      p_summary: null,
      p_detail: { provider: 'economic' },
      p_actor: callerId,
    })
    if (auditErr) console.error('record_audit fejlede:', auditErr.message)
    return json({ ok: true })
  }

  if (action !== 'test') return json({ error: 'unknown_action' }, 400)

  // ── test: GET /self med begge tokens ────────────────────────────────────
  const { data: app } = await admin
    .from('platform_secrets')
    .select('value')
    .eq('key', APP_SECRET_KEY)
    .maybeSingle()
  if (!app?.value) return json({ ok: false, reason: 'app_secret_missing' })

  const { data: sec } = await admin
    .from('company_accounting_secret')
    .select('access_token')
    .eq('company_id', companyId)
    .maybeSingle()
  if (!sec?.access_token) return json({ ok: false, reason: 'token_missing' })

  try {
    const self = await economicSelf({ appSecretToken: app.value, agreementGrantToken: sec.access_token })

    // Service-role skriver uden auth.uid(), så statusværnet lader felterne
    // passere (guard_accounting_config_status).
    const { error: updError } = await admin
      .from('company_accounting_config')
      .update({
        agreement_number: self.agreementNumber,
        agreement_company_name: self.companyName,
        verified_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
    if (updError) console.error('kunne ikke gemme verifikation:', updError)

    const { error: auditErr } = await admin.rpc('record_audit', {
      p_company_id: companyId,
      p_action: 'accounting.verified',
      p_entity_type: 'accounting_config',
      p_entity_id: companyId,
      p_summary: String(self.agreementNumber),
      p_detail: { provider: 'economic', agreement_number: self.agreementNumber },
      p_actor: callerId,
    })
    if (auditErr) console.error('record_audit fejlede:', auditErr.message)

    return json({
      ok: true,
      agreementNumber: self.agreementNumber,
      companyName: self.companyName,
      baseCurrency: self.baseCurrency,
    })
  } catch (e) {
    const reason = economicReason(e)
    // Kun årsagskoden når ud — e-conomics fejltekst og logId bliver serverside.
    console.warn('e-conomic test fejlede:', reason, e instanceof Error ? e.message : e)
    return json({ ok: false, reason })
  }
})

// entra-config — skriver kundens Entra client secret og tester forbindelsen.
//
// Hemmeligheden går KUN denne vej: company_entra_secret har hverken RLS-
// politikker eller grants, så den kan ikke læses eller skrives gennem
// PostgREST. Browseren kan sætte en ny værdi og se "sat ✓" (spejlet over i
// company_entra_config.client_secret_set af en trigger), men aldrig læse den
// igen. Test og gruppeopslag sker her, hvor hemmeligheden findes.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { callerCanManageCompany } from '../_shared/user-admin.ts'
import { EntraError, fetchGroups, fetchUsers, getToken } from '../_shared/entra.ts'

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

type Body = {
  companyId?: string
  action?: 'save_secret' | 'clear_secret' | 'test' | 'groups'
  clientSecret?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
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

  // Integrationen skal være udbudt af platformen; ellers er endepunktet lukket
  // uanset hvad kunden måtte have liggende i sin egen konfiguration.
  const { data: platform } = await admin
    .from('platform_settings')
    .select('entra_enabled')
    .maybeSingle()
  if (!platform?.entra_enabled) return json({ error: 'integration_disabled' }, 403)

  if (action === 'save_secret' || action === 'clear_secret') {
    const secret = action === 'save_secret' ? (body.clientSecret ?? '').trim() : ''
    if (action === 'save_secret' && !secret) return json({ error: 'secret_required' }, 400)
    // Konfigurationsrækken skal findes, før triggeren kan spejle "sat"-flaget.
    const { error: cfgError } = await admin
      .from('company_entra_config')
      .upsert({ company_id: companyId }, { onConflict: 'company_id', ignoreDuplicates: true })
    if (cfgError) return json({ error: 'save_failed', detail: cfgError.message }, 500)

    const { error } = await admin
      .from('company_entra_secret')
      .upsert({ company_id: companyId, client_secret: secret || null }, { onConflict: 'company_id' })
    if (error) return json({ error: 'save_failed', detail: error.message }, 500)

    // Ny hemmelighed ⇒ tidligere tørkørsel gælder ikke længere (samme regel som
    // ved skift af tenant/klient/gruppe, der håndhæves af databasetriggeren).
    await admin.from('company_entra_config')
      .update({ dry_run_at: null })
      .eq('company_id', companyId)

    await admin.rpc('record_audit', {
      p_company_id: companyId,
      p_action: action === 'save_secret' ? 'entra.secret_set' : 'entra.secret_cleared',
      p_entity_type: 'entra_config',
      p_entity_id: companyId,
      p_summary: null,
      p_detail: {},
      p_actor: userData.user.id,
    })
    return json({ ok: true })
  }

  // ── test / groups: kræver fuldt sæt credentials ──
  const { data: cfg } = await admin
    .from('company_entra_config')
    .select('tenant_id, client_id, group_id')
    .eq('company_id', companyId)
    .maybeSingle()
  const { data: sec } = await admin
    .from('company_entra_secret')
    .select('client_secret')
    .eq('company_id', companyId)
    .maybeSingle()

  const creds = {
    tenantId: cfg?.tenant_id ?? '',
    clientId: cfg?.client_id ?? '',
    clientSecret: sec?.client_secret ?? '',
  }
  if (!creds.tenantId || !creds.clientId || !creds.clientSecret) {
    return json({ ok: false, reason: 'incomplete' })
  }

  try {
    const token = await getToken(creds)
    if (action === 'groups') {
      const groups = await fetchGroups(token)
      return json({ ok: true, groups: groups.map((g) => ({ id: g.id, name: g.displayName })) })
    }
    // Test: hent brugerne med det aktuelle filter, så svaret viser hvor mange
    // der faktisk ville blive synkroniseret — ikke bare at login virkede.
    const users = await fetchUsers(token, cfg?.group_id ?? null)
    return json({ ok: true, userCount: users.length })
  } catch (e) {
    const reason = e instanceof EntraError ? e.code : 'auth_failed'
    const detail = e instanceof Error ? e.message : String(e)
    return json({ ok: false, reason, detail })
  }
})

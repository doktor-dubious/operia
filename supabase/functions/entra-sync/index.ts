// entra-sync — henter medarbejdere fra Microsoft Entra ID og kører dem gennem
// den samme importkerne som CSV-filerne (_shared/employee-import.ts). Dermed
// arves validering, beskyttelse af manuelt oprettede, automatisk oprettelse af
// afdelinger og deaktiveringsværnet — der er kun én importmotor.
//
// To indgange:
//   mode=dry_run  manager i UI'et; beregner diff'en uden at skrive noget.
//                 Skal have været kørt én gang, før den første rigtige synk
//                 tillades — en forkert gruppe/tenant må ikke kunne
//                 masse-deaktivere et rigtigt direktorie i tavshed.
//   mode=apply    planlagt kørsel (pg_cron med service-role) eller manuel
//                 "synkronisér nu" fra UI'et.
//
// Logning: hver kørsel skriver en import_runs-række (samme log som CSV-
// importen). Revisionsloggen får kun besked når noget faktisk ændrede sig
// eller kørslen fejlede — ellers ville et 15-minutters interval fylde den med
// "ingen ændringer" og begrave de rigtige hændelser.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { callerCanManageCompany } from '../_shared/user-admin.ts'
import { isServiceRole } from '../_shared/notify.ts'
import {
  applyEmployeeRows,
  type ImportResult,
  type ImportRow,
} from '../_shared/employee-import.ts'
import { EntraError, fetchUsers, getToken, initialsFor, type GraphUser } from '../_shared/entra.ts'

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

// Felter AD-kilden ejer. Alt andet (fx NFC-kort tildelt i appen) røres aldrig,
// præcis som en CSV-fil uden den pågældende kolonne.
const OWNED = new Set([
  'full_name', 'first_name', 'last_name', 'initials', 'email', 'phone', 'department', 'role',
])

// Anonymiseringsetiketten følger virksomhedens sprog, så en dansk kunde ikke
// får engelske navne i sin medarbejderliste.
const ANONYMIZED_LABEL: Record<string, string> = {
  da: 'Anonymiseret medarbejder',
  en: 'Anonymized employee',
}

function toRows(users: GraphUser[], initialsSource?: string | null): {
  rows: ImportRow[]
  errors: { row: number; code: string }[]
} {
  const rows: ImportRow[] = []
  const errors: { row: number; code: string }[] = []
  const seenGuid = new Set<string>()
  users.forEach((u, i) => {
    const rowNumber = i + 1
    const full_name = (u.displayName ?? '').trim() ||
      [u.givenName, u.surname].filter(Boolean).join(' ').trim()
    if (!u.id) return void errors.push({ row: rowNumber, code: 'missingExternalId' })
    if (!full_name) return void errors.push({ row: rowNumber, code: 'missingName' })
    if (seenGuid.has(u.id)) return void errors.push({ row: rowNumber, code: 'duplicateExternalId' })
    seenGuid.add(u.id)
    rows.push({
      rowNumber,
      external_id: u.id,
      // Entra-brugere uden employeeId er helt normale; external_id er nøglen.
      employee_no: (u.employeeId ?? '').trim(),
      full_name,
      first_name: (u.givenName ?? '').trim() || null,
      last_name: (u.surname ?? '').trim() || null,
      initials: initialsFor(u, initialsSource),
      email: (u.mail ?? u.userPrincipalName ?? '').trim() || null,
      phone: (u.mobilePhone ?? '').trim() || null,
      department: (u.department ?? '').trim() || null,
      // Sproget styres i Operia; Entras preferredLanguage overskriver ikke.
      language: null,
      nfc_card_id: null,
      role: (u.jobTitle ?? '').trim() || null,
    })
  })
  return { rows, errors }
}

// Kun ændringer og fejl i revisionsloggen — se hovedkommentaren.
async function auditIfInteresting(
  admin: SupabaseClient,
  companyId: string,
  result: ImportResult,
  failed: boolean,
  detail: Record<string, unknown>,
) {
  const c = result.counts
  const changed = c.created + c.updated + c.deactivated + c.departments > 0
  if (!failed && !changed && result.status === 'applied') return
  await admin.rpc('record_audit', {
    p_company_id: companyId,
    p_action: failed ? 'entra.sync_failed' : 'entra.sync_applied',
    p_entity_type: 'entra_config',
    p_entity_id: companyId,
    p_summary: null,
    p_detail: detail,
    p_actor: null,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const body = (await req.json().catch(() => ({}))) as { companyId?: string; mode?: string }
  const companyId = body.companyId?.trim()
  const mode = body.mode === 'dry_run' ? 'dry_run' : 'apply'
  if (!companyId) return json({ error: 'company_required' }, 400)

  // Autorisation: planlæggeren kommer med service-role; mennesker skal være
  // manager i virksomheden (eller platform-admin).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
  let actor: string | null = null
  if (!isServiceRole(token, serviceKey)) {
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: userData, error: userErr } = await asCaller.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
    if (!(await callerCanManageCompany(admin, userData.user.id, companyId))) {
      return json({ error: 'forbidden' }, 403)
    }
    actor = userData.user.id
  }

  // Platformens hovedafbryder + kundens egen konfiguration.
  const { data: platform } = await admin
    .from('platform_settings')
    .select('entra_enabled, entra_anonymize_retired, default_language')
    .maybeSingle()
  if (!platform?.entra_enabled) return json({ error: 'integration_disabled' }, 403)

  const { data: cfg } = await admin
    .from('company_entra_config')
    .select('enabled, tenant_id, client_id, group_id, initials_source, anonymize_retired, dry_run_at, first_sync_at')
    .eq('company_id', companyId)
    .maybeSingle()
  if (!cfg?.enabled) return json({ error: 'not_enabled' }, 400)

  const { data: sec } = await admin
    .from('company_entra_secret')
    .select('client_secret')
    .eq('company_id', companyId)
    .maybeSingle()

  const creds = {
    tenantId: cfg.tenant_id ?? '',
    clientId: cfg.client_id ?? '',
    clientSecret: sec?.client_secret ?? '',
  }
  if (!creds.tenantId || !creds.clientId || !creds.clientSecret) {
    return json({ error: 'incomplete_config' }, 400)
  }

  // En godkendt tørkørsel af den AKTUELLE opsætning er en forudsætning for
  // enhver rigtig synk — ikke kun den allerførste. Værnet nulstiller dry_run_at
  // når tenant/klient/gruppe ændres, og en ny opsætning må ikke arve en gammel
  // godkendelse (first_sync_at gælder derfor ikke som alternativ).
  if (mode === 'apply' && !cfg.dry_run_at) {
    return json({ error: 'dry_run_required' }, 400)
  }

  // null = arv platformens politik (se migrationens kommentar om arv).
  const anonymize = cfg.anonymize_retired ?? platform.entra_anonymize_retired ?? false
  const lang = platform.default_language ?? 'da'
  const label = ANONYMIZED_LABEL[lang] ?? ANONYMIZED_LABEL.da

  const started = Date.now()
  let result: ImportResult
  let users: GraphUser[]
  try {
    const accessToken = await getToken(creds)
    users = await fetchUsers(accessToken, cfg.group_id)
  } catch (e) {
    const reason = e instanceof EntraError ? e.code : 'auth_failed'
    const detail = e instanceof Error ? e.message : String(e)
    await admin.from('company_entra_config').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'failed',
      last_sync_error: reason,
    }).eq('company_id', companyId)
    if (mode === 'apply') {
      await admin.from('import_runs').insert({
        company_id: companyId, kind: 'employees_entra', status: 'failed',
        errors: [{ row: 0, code: reason }], created_by: actor,
      })
      await auditIfInteresting(admin, companyId, {
        status: 'rejected', counts: { rows_total: 0, created: 0, updated: 0, unchanged: 0, deactivated: 0, skippedManual: 0, departments: 0 }, errors: [],
      }, true, { reason, detail })
    }
    return json({ ok: false, reason, detail })
  }

  const { rows, errors } = toRows(users, cfg.initials_source)

  try {
    result = await applyEmployeeRows(admin, companyId, rows, errors, OWNED, {
      matchOn: 'external_id',
      dryRun: mode === 'dry_run',
      // Værnet gælder ubemandede kørsler; tørkørslen viser tallene til et
      // menneske, der selv tager stilling.
      guardDeactivations: mode === 'apply',
      anonymizeRetired: anonymize,
      anonymizeLabel: label,
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    await admin.from('company_entra_config').update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'failed',
      last_sync_error: 'apply_failed',
    }).eq('company_id', companyId)
    await admin.from('import_runs').insert({
      company_id: companyId, kind: 'employees_entra', status: 'failed',
      rows_total: rows.length, errors: [{ row: 0, code: 'apply_failed' }], created_by: actor,
    })
    return json({ ok: false, reason: 'apply_failed', detail })
  }

  const c = result.counts
  if (mode === 'dry_run') {
    await admin.from('company_entra_config')
      .update({ dry_run_at: new Date().toISOString() })
      .eq('company_id', companyId)
    return json({ ok: true, mode, counts: c, errors: result.errors, userCount: users.length })
  }

  await admin.from('import_runs').insert({
    company_id: companyId,
    kind: 'employees_entra',
    status: result.status,
    rows_total: c.rows_total,
    created_count: c.created,
    updated_count: c.updated,
    unchanged_count: c.unchanged,
    deactivated_count: c.deactivated,
    skipped_manual_count: c.skippedManual,
    departments_created: c.departments,
    rejected_count: result.status === 'rejected' ? c.rows_total : result.errors.length,
    errors: result.errors,
    created_by: actor,
  })

  await admin.from('company_entra_config').update({
    last_sync_at: new Date().toISOString(),
    last_sync_status: result.status === 'applied' ? 'ok' : 'rejected',
    last_sync_error: result.status === 'applied' ? null : (result.fileError ?? null),
    first_sync_at: cfg.first_sync_at ?? new Date().toISOString(),
  }).eq('company_id', companyId)

  await auditIfInteresting(admin, companyId, result, result.status !== 'applied', {
    created: c.created, updated: c.updated, deactivated: c.deactivated,
    departments: c.departments, users: users.length,
    ...(result.fileError ? { reason: result.fileError } : {}),
  })

  return json({ ok: result.status === 'applied', mode, counts: c, errors: result.errors, ms: Date.now() - started })
})

// economic-sync-run — henter fakturanumre hjem for overførte e-conomic-kladder
// uden nummer, for én virksomhed ad gangen. Kaldes af cron-jobbet
// 'operia-economic-sync' (service-rollen) — eller af en økonomibruger, der
// vil have alle kladder synket nu.
//
// e-conomic siger ikke til, når bogholderen bogfører; vi spørger. De bogførte
// fakturaer fra den ældste overførsel og frem hentes ÉN gang pr. kørsel, og
// alle kladdenumre sammenlignes i hukommelsen (findBookedByReferences) — ikke
// ét opslag pr. kladde, som "Hent fakturanummer" på skærmen gør for én.
// Noteringen går gennem record_invoice_booked, så revisionssporet er ens —
// blot med source 'scheduled', når ingen bruger stod bag.
//
// Udfaldet skrives på integrationens række (sync_last_run_*): cron-kalderen
// (net.http_post) smider svaret væk, så det er dér, en fejl kan ses — og
// første fejl i en stribe får en revisionsrække, så den også står i Logs.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { platformSecret } from '../_shared/platform-secret.ts'
import { isServiceRole } from '../_shared/notify.ts'
import { economicReason, findBookedByReference, findBookedByReferences, loadEconomicCreds } from '../_shared/economic.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Draft = { id: string; number: string; transferred_at: string | null }
type Cfg = { enabled: boolean; provider: string; verified_at: string | null; sync_last_run_status: string | null }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const body = (await req.json().catch(() => ({}))) as { companyId?: string; trigger?: string }
  const companyId = body.companyId?.trim()
  if (!companyId) return json({ error: 'company_required' }, 400)

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
  const scheduled = isServiceRole(token, serviceKey)
  // Noteringen sker som kalderen, når der er én: så gælder økonomirollen og
  // revisionssporet får en aktør. Cron noterer som service-rollen.
  let writer = admin
  if (!scheduled) {
    const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: u, error } = await asCaller.auth.getUser()
    if (error || !u.user) return json({ error: 'unauthorized' }, 401)
    const { data: allowed } = await asCaller.rpc('can_invoice_bookings', { p_company_id: companyId })
    if (!allowed) return json({ error: 'forbidden' }, 403)
    writer = asCaller
  }

  const { data: cfg } = await admin.from('company_accounting_config')
    .select('enabled, provider, verified_at, sync_last_run_status').eq('company_id', companyId)
    .maybeSingle<Cfg>()
  if (!cfg?.enabled || cfg.provider !== 'economic' || !cfg.verified_at) return json({ ok: false, reason: 'not_configured' })
  const trigger = scheduled ? 'scheduled' : 'user'

  /** Udfaldet på rækken — og i Logs, første gang en stribe fejler. */
  const finish = async (status: 'ok' | 'failed', error: string | null, extra: Record<string, unknown>) => {
    await admin.from('company_accounting_config')
      .update({ sync_last_run_at: new Date().toISOString(), sync_last_run_status: status, sync_last_run_error: error })
      .eq('company_id', companyId)
    if (status === 'failed') {
      console.warn(`economic sync failed for ${companyId}:`, error)
      if (cfg.sync_last_run_status !== 'failed') {
        const { error: aErr } = await admin.rpc('record_audit', {
          p_company_id: companyId, p_action: 'accounting.sync_failed', p_entity_type: 'company_accounting_config',
          p_entity_id: companyId, p_summary: 'e-conomic', p_detail: { error, trigger, ...extra },
        })
        if (aErr) console.warn('record_audit failed:', aErr.message)
      }
    }
    return json({ ok: status === 'ok', error, trigger, ...extra })
  }

  const creds = await loadEconomicCreds(admin, await platformSecret(admin, 'economic_app_secret_token'), companyId)
  if (!creds) return finish('failed', 'token_missing', { pending: 0, booked: 0 })

  const { data: drafts } = await admin.from('invoice_drafts')
    .select('id, number, transferred_at')
    .eq('company_id', companyId).eq('status', 'transferred').eq('external_system', 'economic').is('invoice_no', null)
    .order('transferred_at')
    .limit(200)
  const pending = (drafts ?? []) as Draft[]
  if (pending.length === 0) return finish('ok', null, { pending: 0, booked: 0 })

  let booked = 0
  const errors: { number: string; reason: string }[] = []
  try {
    // Ét gennemløb for alle: fra den ældste overførsel (listen er sorteret).
    const scan = await findBookedByReferences(creds, pending.map((d) => d.number), pending[0].transferred_at)
    if (!scan.ok) {
      // Ét afvist opslag (udløbet token, for mange kald) gælder dem alle —
      // stop, og lad næste kørsel prøve igen.
      return finish('failed', `http_${scan.res.status}`, { pending: pending.length, booked: 0 })
    }
    for (const d of pending) {
      let no: string | null | undefined = scan.found.get(d.number)
      let matched = scan.found.has(d.number)
      // Blev alle sider ikke læst, kan en umatchet kladde stadig være bogført:
      // spørg direkte på den (ét billigt kald pr. kladde, kun i dét tilfælde).
      if (!matched && !scan.complete) {
        const one = await findBookedByReference(creds, d.number, d.transferred_at)
        if (!one.ok) {
          errors.push({ number: d.number, reason: `http_${one.res.status}` })
          break
        }
        matched = one.matched
        no = one.invoiceNo
      }
      if (!matched) continue
      if (!no) {
        errors.push({ number: d.number, reason: 'invoice_number_unreadable' })
        continue
      }
      const { error } = await writer.rpc('record_invoice_booked', { p_draft_id: d.id, p_invoice_no: no })
      if (error) errors.push({ number: d.number, reason: error.message })
      else booked++
    }
  } catch (e) {
    errors.push({ number: '*', reason: economicReason(e) })
  }
  const first = errors[0]
  return finish(
    errors.length === 0 ? 'ok' : 'failed',
    first ? `${first.reason} (${first.number}${errors.length > 1 ? ` +${errors.length - 1}` : ''})` : null,
    { pending: pending.length, booked, errors },
  )
})

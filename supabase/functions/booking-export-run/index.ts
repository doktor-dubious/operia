// booking-export-run — planlagt fileksport af bookinger (EVU-krav B-02).
//
// Kaldes af pg_cron (service-role) for de virksomheder, der er forfaldne, eller
// manuelt ("Kør nu") af en booking-manager. Danner CSV'en for den valgte
// periode, lægger den i bucket'en 'exports' under virksomhedens mappe,
// registrerer den i booking_export_files og sender modtageren et signeret
// link (7 dage). Filen sendes ikke som vedhæftning: et link kan trækkes
// tilbage, en vedhæftning kan ikke, og loggen kan sige hvem der hentede.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { callerCanManageCompany } from '../_shared/user-admin.ts'
import { isServiceRole, escapeHtml } from '../_shared/notify.ts'
import { sendEmail } from '../_shared/send-email.ts'
import { BOOKING_CSV_SELECT, bookingsCsv, type BookingRow, type Profile, type Shape } from '../_shared/booking-csv.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const LINK_TTL_S = 7 * 24 * 3600
const MAX_ROWS = 5000

type Schedule = {
  company_id: string
  enabled: boolean
  period: string
  shape: Shape
  profile: Profile
  recipient_email: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const body = (await req.json().catch(() => ({}))) as { companyId?: string; trigger?: string; period?: string }
  const companyId = body.companyId?.trim()
  if (!companyId) return json({ error: 'company_required' }, 400)

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
  const scheduled = isServiceRole(token, serviceKey)
  let actor: string | null = null
  if (!scheduled) {
    const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: u, error } = await asCaller.auth.getUser()
    if (error || !u.user) return json({ error: 'unauthorized' }, 401)
    if (!(await callerCanManageCompany(admin, u.user.id, companyId))) return json({ error: 'forbidden' }, 403)
    actor = u.user.id
  }

  const { data: s } = await admin
    .from('company_booking_export_schedule')
    .select('company_id, enabled, period, shape, profile, recipient_email')
    .eq('company_id', companyId)
    .maybeSingle<Schedule>()
  if (!s) return json({ error: 'not_configured' }, 400)
  if (scheduled && (!s.enabled || !s.recipient_email)) return json({ error: 'not_enabled' }, 400)

  const period = body.period ?? s.period
  const { data: per } = await admin.rpc('booking_export_period', { p_period: period }).maybeSingle<{ period_from: string; period_to: string; from_ts: string; to_ts: string }>()
  if (!per) return json({ error: 'period_failed' }, 500)

  const { data: co } = await admin.from('companies').select('name, default_currency').eq('id', companyId).maybeSingle()
  const trigger = scheduled ? 'scheduled' : 'manual'

  try {
    const rows = await fetchRows(admin, companyId, per.from_ts, per.to_ts)
    const { csv, rows: n } = bookingsCsv(rows, s.shape, s.profile, co?.default_currency ?? 'DKK')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const path = `${companyId}/${per.period_from.slice(0, 4)}/bookinger-${per.period_from}_${per.period_to}-${s.shape}-${stamp}.csv`
    const bytes = new TextEncoder().encode(csv)
    const { error: upErr } = await admin.storage.from('exports').upload(path, bytes, { contentType: 'text/csv; charset=utf-8', upsert: false })
    if (upErr) throw new Error(`upload_failed: ${upErr.message}`)

    let delivered: string | null = null
    if (s.recipient_email) {
      const { data: signed } = await admin.storage.from('exports').createSignedUrl(path, LINK_TTL_S)
      if (signed?.signedUrl) {
        const subject = `Operia: bookingeksport ${per.period_from} – ${per.period_to}`
        const html = `<p>Hej,</p><p>Bookingeksporten for <b>${escapeHtml(co?.name ?? '')}</b>, perioden ${per.period_from} – ${per.period_to} (${n} rækker), er klar.</p>
<p><a href="${signed.signedUrl}">Hent filen</a> — linket virker i 7 dage. Filen kan også hentes under Konfigurér → Booking → Planlagt eksport.</p>
<p>Operia</p>`
        const r = await sendEmail(s.recipient_email, subject, html)
        if (r.ok) delivered = s.recipient_email
        else console.warn('export mail failed:', r.error)
      }
    }

    await admin.from('booking_export_files').insert({
      company_id: companyId, trigger, period_from: per.period_from, period_to: per.period_to,
      shape: s.shape, profile: s.profile, rows: n, storage_path: path, bytes: bytes.length,
      delivered_to: delivered, status: 'ok',
    })
    await admin.from('company_booking_export_schedule')
      .update({ last_run_at: new Date().toISOString(), last_run_status: 'ok', last_run_error: null })
      .eq('company_id', companyId)
    await admin.rpc('log_booking_export', {
      p_company_id: companyId, p_scope: 'scheduled', p_rows: n,
      p_detail: { shape: s.shape, profile: s.profile, trigger },
    })
    return json({ ok: true, rows: n, path, delivered })
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300)
    await admin.from('booking_export_files').insert({
      company_id: companyId, trigger, period_from: per.period_from, period_to: per.period_to,
      shape: s.shape, profile: s.profile, status: 'failed', error: msg,
    })
    await admin.from('company_booking_export_schedule')
      .update({ last_run_at: new Date().toISOString(), last_run_status: 'failed', last_run_error: msg })
      .eq('company_id', companyId)
    return json({ ok: false, error: msg }, 500)
  }
})

async function fetchRows(admin: SupabaseClient, companyId: string, from: string, to: string): Promise<BookingRow[]> {
  // Overlap med perioden, som rapporten (E-01): en booking, der starter før
  // og slutter i perioden, hører med.
  const { data, error } = await admin
    .from('bookings')
    .select(BOOKING_CSV_SELECT)
    .eq('company_id', companyId)
    .gte('ends_at', from)
    .lt('starts_at', to)
    .order('starts_at')
    .limit(MAX_ROWS)
  if (error) throw new Error(`query_failed: ${error.message}`)
  return (data ?? []) as unknown as BookingRow[]
}

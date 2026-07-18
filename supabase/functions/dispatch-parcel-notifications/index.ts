// dispatch-parcel-notifications — kaldt af pg_cron. Finder åbne pakker der mangler
// en ankomst-/påmindelses-notifikation, respekterer stilletid, påmindelsesdage/
// toggles/max, entitlements og kanalvalg, renderer skabelonen i modtagerens sprog
// og sender via e-mail (Resend) og/eller SMS (GatewayAPI). Hver afsendelse logges
// i parcel_notifications (NIS2-revisionsspor + dedup + tælling mod max).
//
// Autoriseres som service-role (JWT-rolle 'service_role'), ligesom
// log-drain-dispatch. Provider-hemmelighederne (Resend/GatewayAPI) læses kun her.
//
// Bevidste rammer for et første, sikkert udrul:
//   • Hovedafbryder platform_settings.parcel_notifications_enabled skal være true
//     (cron-jobbet gater også på den) — intet sker utilsigtet ved deploy.
//   • Ankomst sendes kun for pakker under ARRIVAL_MAX_AGE_DAYS gamle (ellers ville
//     et helt bagkatalog få "din pakke er ankommet" på én gang).
//   • Kun pakker nyere end LOOKBACK_DAYS og højst MAX_PARCELS pr. kørsel.
//   • Gentagende påmindelser (samme type flere gange) er IKKE implementeret endnu;
//     parcel_reminder_max tolkes som loft over antal påmindelses-lejligheder pr.
//     pakke (reminder_1 + reminder_2). Interval-baserede gentagelser er en
//     senere udvidelse.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendSms } from '../_shared/send-sms.ts'
import { sendEmail } from '../_shared/send-email.ts'
import {
  DAY,
  classifySendError,
  copenhagenDate,
  copenhagenMinutes,
  fmtDate,
  inQuietHours,
  isServiceRole,
  render,
  renderHtml,
  resolveTemplate,
} from '../_shared/notify.ts'

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

const OPEN_STATUSES = ['registered', 'in_storage', 'in_transit', 'in_locker']
const ARRIVAL_MAX_AGE_DAYS = 2
const LOOKBACK_DAYS = 60
const MAX_PARCELS = 200
const MAX_ATTEMPTS = 3 // giv op efter så mange fejlede forsøg pr. type/kanal

type Kind = 'arrival' | 'reminder_1' | 'reminder_2'
type Channel = 'email' | 'sms'

const EMAIL_KEY: Record<Kind, string> = {
  arrival: 'package_arrival',
  reminder_1: 'package_reminder_1',
  reminder_2: 'package_reminder_2',
}
const SMS_KEY: Record<Kind, string> = {
  arrival: 'package_arrival_sms',
  reminder_1: 'package_reminder_1_sms',
  reminder_2: 'package_reminder_2_sms',
}

type EmployeeRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  language: string | null
  is_active: boolean
}
type CompanyRow = {
  id: string
  name: string | null
  default_language: string | null
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  parcel_reminder_1_days: number | null
  parcel_reminder_2_days: number | null
  parcel_reminder_max: number | null
  parcel_reminder_1_enabled: boolean | null
  parcel_reminder_2_enabled: boolean | null
  notify_email_enabled: boolean | null
  notify_sms_enabled: boolean | null
}
type ParcelRow = {
  id: string
  barcode: string | null
  registered_at: string
  company_id: string
  receiver: EmployeeRow | null
  company: CompanyRow | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!isServiceRole(token, serviceKey)) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Platform-standarder + hovedafbryder (belt & suspenders — cron gater også).
  const { data: platform } = await admin
    .from('platform_settings')
    .select(
      'quiet_hours_start, quiet_hours_end, parcel_reminder_1_days, parcel_reminder_2_days, parcel_reminder_max, parcel_reminder_1_enabled, parcel_reminder_2_enabled, notify_email_enabled, notify_sms_enabled, parcel_notifications_enabled',
    )
    .limit(1)
    .maybeSingle()
  if (!platform) return json({ error: 'no_platform_settings' }, 500)
  if (!platform.parcel_notifications_enabled) return json({ ok: true, disabled: true })

  const nowMs = Date.now()
  const nowMin = copenhagenMinutes(new Date(nowMs))
  const today = copenhagenDate(new Date(nowMs))

  // Kandidat-pakker: åbne, med aktiv modtager, nyere end lookback.
  const { data: parcelData, error: parcelErr } = await admin
    .from('parcels')
    .select(
      `id, barcode, registered_at, company_id,
       receiver:employees!inner (id, full_name, email, phone, language, is_active),
       company:companies!inner (id, name, default_language, quiet_hours_start, quiet_hours_end,
         parcel_reminder_1_days, parcel_reminder_2_days, parcel_reminder_max,
         parcel_reminder_1_enabled, parcel_reminder_2_enabled,
         notify_email_enabled, notify_sms_enabled)`,
    )
    .in('status', OPEN_STATUSES)
    .not('receiver_employee_id', 'is', null)
    .gte('registered_at', new Date(nowMs - LOOKBACK_DAYS * DAY).toISOString())
    .order('registered_at', { ascending: true })
    .limit(MAX_PARCELS)
  if (parcelErr) return json({ error: 'query_failed', detail: parcelErr.message }, 500)

  const parcels = (parcelData ?? []) as unknown as ParcelRow[]
  if (parcels.length === 0) return json({ ok: true, processed: 0, sent: 0, failed: 0 })

  const parcelIds = parcels.map((p) => p.id)
  const companyIds = [...new Set(parcels.map((p) => p.company_id))]

  // Entitlements: parcels-produkt (ankomst) + reminders/sms_notifications-features.
  const validUntilOk = (v: string | null) => v == null || v >= today
  const [prodRes, featRes, notifRes, ptplRes, ctplRes] = await Promise.all([
    admin.from('company_products').select('company_id, valid_until').eq('product_key', 'parcels').in('company_id', companyIds),
    admin.from('company_features').select('company_id, feature_key, valid_until').in('feature_key', ['reminders', 'sms_notifications']).in('company_id', companyIds),
    admin.from('parcel_notifications').select('parcel_id, kind, channel, status').in('parcel_id', parcelIds),
    admin.from('platform_templates').select('key, lang, title, body').in('key', [...Object.values(EMAIL_KEY), ...Object.values(SMS_KEY)]),
    admin.from('company_templates').select('company_id, key, lang, title, body').in('key', [...Object.values(EMAIL_KEY), ...Object.values(SMS_KEY)]).in('company_id', companyIds),
  ])

  const productOk = new Set(
    (prodRes.data ?? []).filter((r) => validUntilOk(r.valid_until)).map((r) => r.company_id),
  )
  const featureMap = new Map<string, Set<string>>()
  for (const r of featRes.data ?? []) {
    if (!validUntilOk(r.valid_until)) continue
    if (!featureMap.has(r.company_id)) featureMap.set(r.company_id, new Set())
    featureMap.get(r.company_id)!.add(r.feature_key)
  }

  // Allerede afsendt / fejlet pr. (pakke, type, kanal).
  const sentSet = new Set<string>()
  const failedCount = new Map<string, number>()
  const sentReminderKinds = new Map<string, Set<string>>()
  for (const r of notifRes.data ?? []) {
    const key = `${r.parcel_id}:${r.kind}:${r.channel}`
    if (r.status === 'sent') {
      sentSet.add(key)
      if (r.kind !== 'arrival') {
        if (!sentReminderKinds.has(r.parcel_id)) sentReminderKinds.set(r.parcel_id, new Set())
        sentReminderKinds.get(r.parcel_id)!.add(r.kind)
      }
    } else if (r.status === 'failed') {
      failedCount.set(key, (failedCount.get(key) ?? 0) + 1)
    }
  }

  // Skabelon-resolver (delt med aktiv-dispatcheren via notify.ts): virksomheds-
  // override vinder over platform; fald tilbage til dansk hvis sproget mangler.
  const ptpls = ptplRes.data ?? []
  const ctpls = ctplRes.data ?? []
  const tpl = (companyId: string, key: string, lang: string) =>
    resolveTemplate(ptpls, ctpls, companyId, key, lang)

  let processed = 0
  let sent = 0
  let failed = 0
  let skippedQuiet = 0

  for (const p of parcels) {
    const emp = p.receiver
    const co = p.company
    if (!emp || !co || !emp.is_active) continue
    if (!productOk.has(p.company_id)) continue

    const feats = featureMap.get(p.company_id) ?? new Set<string>()
    const hasReminders = feats.has('reminders')
    const hasSms = feats.has('sms_notifications')

    // Effektive indstillinger: virksomhedens override, ellers platformens.
    const emailOn = co.notify_email_enabled ?? platform.notify_email_enabled
    const smsOn = (co.notify_sms_enabled ?? platform.notify_sms_enabled) && hasSms
    const r1on = co.parcel_reminder_1_enabled ?? platform.parcel_reminder_1_enabled
    const r2on = (co.parcel_reminder_2_enabled ?? platform.parcel_reminder_2_enabled) && r1on
    const r1days = co.parcel_reminder_1_days ?? platform.parcel_reminder_1_days ?? 3
    const r2days = co.parcel_reminder_2_days ?? platform.parcel_reminder_2_days ?? 7
    const max = co.parcel_reminder_max ?? platform.parcel_reminder_max ?? 0
    const qStart = co.quiet_hours_start ?? platform.quiet_hours_start
    const qEnd = co.quiet_hours_end ?? platform.quiet_hours_end

    const channels: Channel[] = []
    if (emailOn) channels.push('email')
    if (smsOn) channels.push('sms')
    if (channels.length === 0) continue

    // Stilletid: udskyd hele pakken til efter det stille vindue (næste kørsel).
    if (inQuietHours(nowMin, qStart, qEnd)) {
      skippedQuiet++
      continue
    }

    const lang = emp.language || co.default_language || 'da'
    const ageDays = (nowMs - Date.parse(p.registered_at)) / DAY

    const candidates: Kind[] = []
    if (ageDays <= ARRIVAL_MAX_AGE_DAYS) candidates.push('arrival')
    if (hasReminders && r1on && ageDays >= r1days) candidates.push('reminder_1')
    if (hasReminders && r2on && ageDays >= r2days) candidates.push('reminder_2')
    if (candidates.length === 0) continue

    const tokens: Record<string, string> = {
      recipient_name: emp.full_name ?? '',
      barcode: p.barcode ?? '',
      date: fmtDate(p.registered_at, lang),
      company_name: co.name ?? '',
    }

    let remCount = sentReminderKinds.get(p.id)?.size ?? 0
    let touched = false

    for (const kind of candidates) {
      const isReminder = kind !== 'arrival'
      if (isReminder && max > 0 && remCount >= max) continue
      let occasionSent = false

      for (const channel of channels) {
        const key = `${p.id}:${kind}:${channel}`
        if (sentSet.has(key)) continue
        if ((failedCount.get(key) ?? 0) >= MAX_ATTEMPTS) continue

        const to = channel === 'email' ? emp.email : emp.phone
        if (!to) continue

        const templateKey = channel === 'email' ? EMAIL_KEY[kind] : SMS_KEY[kind]
        const { title, body } = tpl(p.company_id, templateKey, lang)
        if (!body) continue // ingen skabelon → send ikke tomt

        let result: { ok: boolean; error?: string; id?: string }
        if (channel === 'email') {
          result = await sendEmail(to, render(title, tokens), renderHtml(body, tokens))
        } else {
          result = await sendSms(to, render(body, tokens))
        }

        touched = true
        await admin.from('parcel_notifications').insert({
          company_id: p.company_id,
          parcel_id: p.id,
          employee_id: emp.id,
          kind,
          channel,
          lang,
          recipient: to,
          status: result.ok ? 'sent' : 'failed',
          provider_id: result.id ?? null,
          error: result.ok ? null : (result.error ?? '').slice(0, 500),
        })

        if (result.ok) {
          sent++
          sentSet.add(key)
          occasionSent = true
        } else {
          failed++
          failedCount.set(key, (failedCount.get(key) ?? 0) + 1)
          // Fejl synlig i Logs (audit_log) på 'error'-niveau — samme mønster som
          // aktiv-dispatcheren, så en manager ser at modtageren ikke fik besked.
          // Kun fejl logges (kvitteringer ville oversvømme aktivitetsloggen).
          await admin.rpc('log_notification_event', {
            p_company_id: p.company_id,
            p_action: 'parcel.reminder_failed',
            p_entity_type: 'parcel',
            p_entity_id: p.id,
            p_summary: `${p.barcode || '—'} → ${emp.full_name || '—'}`,
            p_detail: {
              channel,
              kind,
              recipient: to,
              reason: classifySendError(result.error ?? '', channel),
              error: (result.error ?? '').slice(0, 300),
            },
          })
        }
      }

      if (isReminder && occasionSent) remCount++
    }

    if (touched) processed++
  }

  return json({ ok: true, processed, sent, failed, skippedQuiet, candidates: parcels.length })
})

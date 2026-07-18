// dispatch-asset-reminders — kaldt af pg_cron. Finder åbne aktiv-udlån hvis
// udløb (expires_at) er passeret og som mangler en udløbs-/påmindelses-besked,
// respekterer stilletid, påmindelsesdage/toggles/max, entitlements og kanalvalg,
// renderer skabelonen i virksomhedens sprog og sender via e-mail (Resend) og/eller
// SMS (GatewayAPI). Hver afsendelse logges i asset_loan_notifications.
//
// Samme mønster og sikkerhedsrammer som dispatch-parcel-notifications, blot
// forankret på UDLØB i stedet for registrering. Autoriseres som service-role.
//
//   • Hovedafbryder platform_settings.asset_notifications_enabled skal være true.
//   • Udløbs-beskeden sendes kun for udlån udløbet inden for EXPIRY_MAX_AGE_DAYS
//     (ellers ville et helt bagkatalog af udløbne udlån få besked på én gang).
//   • Påmindelse 1/2 sendes N/M dage EFTER udløb. Gentagende påmindelser er ikke
//     implementeret; asset_reminder_max er loft over antal påmindelses-lejligheder.

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

const EXPIRY_MAX_AGE_DAYS = 2 // hvor længe efter udløb udløbs-beskeden må sendes
const LOOKBACK_DAYS = 60
const MAX_LOANS = 200
const MAX_ATTEMPTS = 3

type Kind = 'arrival' | 'reminder_1' | 'reminder_2' // 'arrival' = udløbs-besked
type Channel = 'email' | 'sms'

const EMAIL_KEY: Record<Kind, string> = {
  arrival: 'asset_expiry',
  reminder_1: 'asset_reminder_1',
  reminder_2: 'asset_reminder_2',
}
const SMS_KEY: Record<Kind, string> = {
  arrival: 'asset_expiry_sms',
  reminder_1: 'asset_reminder_1_sms',
  reminder_2: 'asset_reminder_2_sms',
}

type CompanyRow = {
  id: string
  name: string | null
  default_language: string | null
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  asset_reminder_1_days: number | null
  asset_reminder_2_days: number | null
  asset_reminder_max: number | null
  asset_reminder_1_enabled: boolean | null
  asset_reminder_2_enabled: boolean | null
  notify_email_enabled: boolean | null
  notify_sms_enabled: boolean | null
}
type AssetRow = { name: string | null; asset_tag: string | null }
type LoanRow = {
  id: string
  asset_id: string
  company_id: string
  to_name: string
  to_email: string | null
  to_phone: string | null
  expires_at: string
  company: CompanyRow | null
  asset: AssetRow | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!isServiceRole(token, serviceKey)) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: platform } = await admin
    .from('platform_settings')
    .select(
      'quiet_hours_start, quiet_hours_end, asset_reminder_1_days, asset_reminder_2_days, asset_reminder_max, asset_reminder_1_enabled, asset_reminder_2_enabled, notify_email_enabled, notify_sms_enabled, asset_notifications_enabled',
    )
    .limit(1)
    .maybeSingle()
  if (!platform) return json({ error: 'no_platform_settings' }, 500)
  if (!platform.asset_notifications_enabled) return json({ ok: true, disabled: true })

  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const nowMin = copenhagenMinutes(new Date(nowMs))
  const today = copenhagenDate(new Date(nowMs))

  // Kandidat-udlån: åbne (ikke returneret), med udløb, udløbet, inden for lookback.
  const { data: loanData, error: loanErr } = await admin
    .from('asset_loans')
    .select(
      `id, asset_id, company_id, to_name, to_email, to_phone, expires_at,
       company:companies!inner (id, name, default_language, quiet_hours_start, quiet_hours_end,
         asset_reminder_1_days, asset_reminder_2_days, asset_reminder_max,
         asset_reminder_1_enabled, asset_reminder_2_enabled,
         notify_email_enabled, notify_sms_enabled),
       asset:assets (name, asset_tag)`,
    )
    .is('returned_at', null)
    .not('expires_at', 'is', null)
    .lte('expires_at', nowIso)
    .gte('expires_at', new Date(nowMs - LOOKBACK_DAYS * DAY).toISOString())
    .order('expires_at', { ascending: true })
    .limit(MAX_LOANS)
  if (loanErr) return json({ error: 'query_failed', detail: loanErr.message }, 500)

  const loans = (loanData ?? []) as unknown as LoanRow[]
  if (loans.length === 0) return json({ ok: true, processed: 0, sent: 0, failed: 0 })

  const loanIds = loans.map((l) => l.id)
  const companyIds = [...new Set(loans.map((l) => l.company_id))]

  // Entitlements: assets-produkt (alle aktiv-notifikationer) + sms_notifications
  // (kun SMS-kanalen).
  const validUntilOk = (v: string | null) => v == null || v >= today
  const [prodRes, featRes, notifRes, ptplRes, ctplRes] = await Promise.all([
    admin.from('company_products').select('company_id, valid_until').eq('product_key', 'assets').in('company_id', companyIds),
    admin.from('company_features').select('company_id, feature_key, valid_until').eq('feature_key', 'sms_notifications').in('company_id', companyIds),
    admin.from('asset_loan_notifications').select('loan_id, kind, channel, status').in('loan_id', loanIds),
    admin.from('platform_templates').select('key, lang, title, body').in('key', [...Object.values(EMAIL_KEY), ...Object.values(SMS_KEY)]),
    admin.from('company_templates').select('company_id, key, lang, title, body').in('key', [...Object.values(EMAIL_KEY), ...Object.values(SMS_KEY)]).in('company_id', companyIds),
  ])

  const productOk = new Set(
    (prodRes.data ?? []).filter((r) => validUntilOk(r.valid_until)).map((r) => r.company_id),
  )
  const smsCompanies = new Set(
    (featRes.data ?? []).filter((r) => validUntilOk(r.valid_until)).map((r) => r.company_id),
  )

  const sentSet = new Set<string>()
  const failedCount = new Map<string, number>()
  const sentReminderKinds = new Map<string, Set<string>>()
  for (const r of notifRes.data ?? []) {
    const key = `${r.loan_id}:${r.kind}:${r.channel}`
    if (r.status === 'sent') {
      sentSet.add(key)
      // KUN de automatiske påmindelses-lejligheder tæller mod asset_reminder_max.
      // Manuelle nudges (kind='manual', fra send-asset-reminder) og udløbs-beskeden
      // ('arrival') må ALDRIG opbruge det automatiske loft — ellers kan ét manager-
      // klik på "Send påmindelse nu" permanent blokere den planlagte reminder_1/2.
      if (r.kind === 'reminder_1' || r.kind === 'reminder_2') {
        if (!sentReminderKinds.has(r.loan_id)) sentReminderKinds.set(r.loan_id, new Set())
        sentReminderKinds.get(r.loan_id)!.add(r.kind)
      }
    } else if (r.status === 'failed') {
      failedCount.set(key, (failedCount.get(key) ?? 0) + 1)
    }
  }

  const ptpls = ptplRes.data ?? []
  const ctpls = ctplRes.data ?? []
  const tpl = (companyId: string, key: string, lang: string) =>
    resolveTemplate(ptpls, ctpls, companyId, key, lang)

  let processed = 0
  let sent = 0
  let failed = 0
  let skippedQuiet = 0

  for (const loan of loans) {
    const co = loan.company
    if (!co) continue
    if (!productOk.has(loan.company_id)) continue

    const emailOn = co.notify_email_enabled ?? platform.notify_email_enabled
    const smsOn =
      (co.notify_sms_enabled ?? platform.notify_sms_enabled) && smsCompanies.has(loan.company_id)
    const r1on = co.asset_reminder_1_enabled ?? platform.asset_reminder_1_enabled
    const r2on = (co.asset_reminder_2_enabled ?? platform.asset_reminder_2_enabled) && r1on
    const r1days = co.asset_reminder_1_days ?? platform.asset_reminder_1_days ?? 3
    const r2days = co.asset_reminder_2_days ?? platform.asset_reminder_2_days ?? 7
    const max = co.asset_reminder_max ?? platform.asset_reminder_max ?? 0
    const qStart = co.quiet_hours_start ?? platform.quiet_hours_start
    const qEnd = co.quiet_hours_end ?? platform.quiet_hours_end

    const channels: Channel[] = []
    if (emailOn) channels.push('email')
    if (smsOn) channels.push('sms')
    if (channels.length === 0) continue

    if (inQuietHours(nowMin, qStart, qEnd)) {
      skippedQuiet++
      continue
    }

    const lang = co.default_language || 'da'
    const ageDays = (nowMs - Date.parse(loan.expires_at)) / DAY // dage siden udløb

    const candidates: Kind[] = []
    if (ageDays <= EXPIRY_MAX_AGE_DAYS) candidates.push('arrival')
    if (r1on && ageDays >= r1days) candidates.push('reminder_1')
    if (r2on && ageDays >= r2days) candidates.push('reminder_2')
    if (candidates.length === 0) continue

    const tokens: Record<string, string> = {
      recipient_name: loan.to_name ?? '',
      asset_name: loan.asset?.name || loan.asset?.asset_tag || '',
      expiry_date: fmtDate(loan.expires_at, lang),
      company_name: co.name ?? '',
    }

    let remCount = sentReminderKinds.get(loan.id)?.size ?? 0
    let touched = false

    for (const kind of candidates) {
      const isReminder = kind !== 'arrival'
      if (isReminder && max > 0 && remCount >= max) continue
      let occasionSent = false

      for (const channel of channels) {
        const key = `${loan.id}:${kind}:${channel}`
        if (sentSet.has(key)) continue
        if ((failedCount.get(key) ?? 0) >= MAX_ATTEMPTS) continue

        const to = channel === 'email' ? loan.to_email : loan.to_phone
        if (!to) continue

        const templateKey = channel === 'email' ? EMAIL_KEY[kind] : SMS_KEY[kind]
        const { title, body } = tpl(loan.company_id, templateKey, lang)
        if (!body) continue

        let result: { ok: boolean; error?: string; id?: string }
        if (channel === 'email') {
          result = await sendEmail(to, render(title, tokens), renderHtml(body, tokens))
        } else {
          result = await sendSms(to, render(body, tokens))
        }

        touched = true
        await admin.from('asset_loan_notifications').insert({
          company_id: loan.company_id,
          loan_id: loan.id,
          asset_id: loan.asset_id,
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
          // Fejl synlig i Logs (audit_log) på 'error'-niveau. Kun fejl logges her
          // — kvitteringer ville oversvømme aktivitetsloggen med hver auto-udsendelse.
          await admin.rpc('log_notification_event', {
            p_company_id: loan.company_id,
            p_action: 'asset.reminder_failed',
            p_entity_type: 'asset_loan',
            p_entity_id: loan.id,
            p_summary: `${tokens.asset_name || '—'} → ${loan.to_name}`,
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

  return json({ ok: true, processed, sent, failed, skippedQuiet, candidates: loans.length })
})

// send-test-status — testknappen på Konfigurér → Notifikationer → Statusbesked.
//
// To tilstande:
//   • preview: hvilke modtagere har lige nu en statusbesked på vej? (navn,
//     e-mail/telefon, antal pakker) — så manageren kan vælge én at teste med.
//   • send: send sammendraget til ÉN valgt modtager med det samme.
//
// Udvælgelsen deles med dispatcheren (_shared/parcel-digest.ts), så listen viser
// præcis det den planlagte udsendelse ville sende.
//
// SIKKERHED (browseren er utroværdig, se CLAUDE.md):
//   • Kalderens rolle genverificeres server-side: platform-admin, eller manager
//     for netop den virksomhed (callerCanManageCompany — samme regel som
//     brugeradministrationen).
//   • Modtageren angives som employee_id og skal være en aktiv medarbejder i
//     DEN virksomhed med pakker på vej — ikke en kaldersuppliret adresse. Det
//     kan altså ikke bruges som åbent mail-/SMS-relay.
//   • Teksten er virksomhedens egen package_status-skabelon; intet indhold
//     kommer fra kalderen.
//
// Testsendinger logges i parcel_notifications med digest_key = 'test-<ISO>', så
// de indgår i revisionssporet uden at tælle som dagens sammendrag eller rykke
// vinduet for den rigtige udsendelse (se parseDigestHistory).

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendSms } from '../_shared/send-sms.ts'
import { sendEmail } from '../_shared/send-email.ts'
import {
  DAY,
  classifySendError,
  copenhagenDate,
  maskRecipient,
  render,
  renderHtml,
  resolveTemplate,
  sanitizeProviderError,
} from '../_shared/notify.ts'
import {
  DELIVERED_STATUS,
  OPEN_STATUSES,
  PARCEL_SELECT,
  STATUS_EMAIL_KEY,
  STATUS_SMS_KEY,
  TEST_DIGEST_PREFIX,
  buildUnits,
  deliveredItems,
  digestCount,
  digestItems,
  digestTokens,
  digestWindowStart,
  groupUnitsByEmployee,
  parseDigestHistory,
  type ParcelRow,
} from '../_shared/parcel-digest.ts'
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

// Samme rammer som dispatcheren, så forhåndsvisningen ikke viser andet end den.
const LOOKBACK_DAYS = 60
const MAX_PARCELS = 200
const DIGEST_LOOKBACK_DAYS = 30

type Body = { companyId?: string; mode?: 'preview' | 'send'; employeeId?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1) Verificér kalderen ud fra deres egen JWT.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
  const callerId = userData.user.id

  const body = (await req.json().catch(() => ({}))) as Body
  const companyId = body.companyId?.trim()
  const mode = body.mode === 'send' ? 'send' : 'preview'
  if (!companyId) return json({ error: 'company_required' }, 400)
  if (mode === 'send' && !body.employeeId) return json({ error: 'employee_required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 2) Autorisation: platform-admin, eller manager for netop denne virksomhed.
  if (!(await callerCanManageCompany(admin, callerId, companyId))) {
    return json({ error: 'forbidden' }, 403)
  }

  const nowMs = Date.now()
  const today = copenhagenDate(new Date(nowMs))

  // 3) Platformens hovedafbryder gælder også en test — er pakke-notifikationer
  //    slået fra globalt, sendes der intet (forhåndsvisning er stadig tilladt).
  const { data: platform } = await admin
    .from('platform_settings')
    .select('parcel_notifications_enabled, notify_email_enabled, notify_sms_enabled')
    .limit(1)
    .maybeSingle()
  if (!platform) return json({ error: 'no_platform_settings' }, 500)
  if (mode === 'send' && !platform.parcel_notifications_enabled) {
    return json({ ok: false, error: 'notifications_disabled' })
  }

  // 4) Samme kandidatudvælgelse som dispatcheren, men kun for denne virksomhed:
  //    både ventende og udleverede pakker.
  const [parcelRes, deliveredRes] = await Promise.all([
    admin
      .from('parcels')
      .select(PARCEL_SELECT)
      .eq('company_id', companyId)
      .in('status', OPEN_STATUSES)
      .not('receiver_employee_id', 'is', null)
      .gte('registered_at', new Date(nowMs - LOOKBACK_DAYS * DAY).toISOString())
      .order('registered_at', { ascending: true })
      .limit(MAX_PARCELS),
    admin
      .from('parcels')
      .select(PARCEL_SELECT)
      .eq('company_id', companyId)
      .eq('status', DELIVERED_STATUS)
      .not('receiver_employee_id', 'is', null)
      .gte('delivered_at', new Date(nowMs - DIGEST_LOOKBACK_DAYS * DAY).toISOString())
      .order('registered_at', { ascending: true })
      .limit(MAX_PARCELS),
  ])
  if (parcelRes.error) return json({ error: 'query_failed', detail: parcelRes.error.message }, 500)
  if (deliveredRes.error) {
    return json({ error: 'query_failed', detail: deliveredRes.error.message }, 500)
  }

  const parcels = (parcelRes.data ?? []) as unknown as ParcelRow[]
  const delivered = (deliveredRes.data ?? []) as unknown as ParcelRow[]
  const finishedBatchIds = [
    ...new Set(
      parcels
        .filter((p) => p.batch_id && p.batch?.status === 'finished')
        .map((p) => p.batch_id as string),
    ),
  ]

  const [batchMemberRes, digestRes, ptplRes, ctplRes] = await Promise.all([
    finishedBatchIds.length
      ? admin.from('parcels').select('batch_id').in('batch_id', finishedBatchIds)
      : Promise.resolve({ data: [] as { batch_id: string }[] }),
    admin
      .from('parcel_notifications')
      .select('employee_id, channel, status, digest_key, created_at')
      .eq('kind', 'status')
      .eq('company_id', companyId)
      .gte('created_at', new Date(nowMs - DIGEST_LOOKBACK_DAYS * DAY).toISOString()),
    admin
      .from('platform_templates')
      .select('key, lang, title, body')
      .in('key', [STATUS_EMAIL_KEY, STATUS_SMS_KEY]),
    admin
      .from('company_templates')
      .select('company_id, key, lang, title, body')
      .in('key', [STATUS_EMAIL_KEY, STATUS_SMS_KEY])
      .eq('company_id', companyId),
  ])

  const batchCounts = new Map<string, number>()
  for (const r of batchMemberRes.data ?? []) {
    batchCounts.set(r.batch_id, (batchCounts.get(r.batch_id) ?? 0) + 1)
  }
  const { lastDigestAt } = parseDigestHistory(digestRes.data ?? [], today)

  // 5) Byg sammendragene pr. modtager — kun dem der faktisk har noget at melde
  //    (ventende pakker, udleverede pakker, eller begge dele).
  const pending = groupUnitsByEmployee(buildUnits(parcels, batchCounts), delivered)
    .map((g) => {
      const since = digestWindowStart(lastDigestAt, g.emp.id, nowMs)
      return { g, items: digestItems(g.units, since), handed: deliveredItems(g.delivered, since) }
    })
    .filter((x) => x.items.length > 0 || x.handed.length > 0)

  // SMS kræver tilvalget sms_notifications pr. kunde (som i dispatcheren).
  const { data: featRows } = await admin
    .from('company_features')
    .select('feature_key, valid_until')
    .eq('company_id', companyId)
    .eq('feature_key', 'sms_notifications')
  const hasSms = (featRows ?? []).some((f) => f.valid_until == null || f.valid_until >= today)

  const { data: company } = await admin
    .from('companies')
    .select('notify_email_enabled, notify_sms_enabled')
    .eq('id', companyId)
    .maybeSingle()
  const emailOn = company?.notify_email_enabled ?? platform.notify_email_enabled
  const smsOn = (company?.notify_sms_enabled ?? platform.notify_sms_enabled) && hasSms

  if (mode === 'preview') {
    return json({
      ok: true,
      emailEnabled: emailOn,
      smsEnabled: smsOn,
      notificationsEnabled: platform.parcel_notifications_enabled,
      candidates: pending.map(({ g, items, handed }) => ({
        employeeId: g.emp.id,
        name: g.emp.full_name,
        email: g.emp.email,
        phone: g.emp.phone,
        count: digestCount(items),
        deliveredCount: digestCount(handed),
      })),
    })
  }

  // 6) Send til den valgte modtager. Testen springer bevidst klokkeslæt,
  //    stilletid og statusbesked-togglen over — det er en manuel handling der
  //    skal kunne bruges FØR funktionen slås til. Kanalvalget respekteres, for
  //    det er netop dét (plus skabelon og levering) testen skal bekræfte.
  const target = pending.find((x) => x.g.emp.id === body.employeeId)
  if (!target) return json({ ok: false, error: 'no_pending_parcels' })

  const { emp, co } = target.g
  const items = target.items
  const handed = target.handed
  const lang = emp.language || co.default_language || 'da'
  const tokens = digestTokens(items, handed, emp, co, lang, nowMs)
  const digestKey = `${TEST_DIGEST_PREFIX}${new Date(nowMs).toISOString()}`
  // Repræsentativ pakke til loggen (parcel_id er not null) — første ventende,
  // ellers første udleverede når sammendraget kun melder udleveringer.
  const repParcelId = (items[0] ?? handed[0]).parcel.id
  const totalCount = digestCount(items) + digestCount(handed)

  const channels: ('email' | 'sms')[] = []
  if (emailOn) channels.push('email')
  if (smsOn) channels.push('sms')

  const results: { channel: string; ok: boolean; error?: string }[] = []
  for (const channel of channels) {
    const to = channel === 'email' ? emp.email : emp.phone
    if (!to) {
      results.push({ channel, ok: false, error: 'no_recipient' })
      continue
    }
    const { title, body: tplBody } = resolveTemplate(
      ptplRes.data ?? [],
      ctplRes.data ?? [],
      companyId,
      channel === 'email' ? STATUS_EMAIL_KEY : STATUS_SMS_KEY,
      lang,
    )
    if (!tplBody) {
      results.push({ channel, ok: false, error: 'no_template' })
      continue
    }

    const result = channel === 'email'
      ? await sendEmail(to, render(title, tokens), renderHtml(tplBody, tokens))
      : await sendSms(to, render(tplBody, tokens))

    await admin.from('parcel_notifications').insert({
      company_id: companyId,
      parcel_id: repParcelId,
      batch_id: null,
      employee_id: emp.id,
      kind: 'status',
      channel,
      lang,
      recipient: to,
      status: result.ok ? 'sent' : 'failed',
      provider_id: result.id ?? null,
      error: result.ok ? null : sanitizeProviderError(result.error, 500),
      digest_key: digestKey,
    })

    if (!result.ok) {
      await admin.rpc('log_notification_event', {
        p_company_id: companyId,
        p_action: 'parcel.reminder_failed',
        p_entity_type: 'parcel',
        p_entity_id: repParcelId,
        p_summary: `${totalCount}`,
        p_detail: {
          channel,
          kind: 'status',
          test: true,
          recipient: maskRecipient(to),
          reason: classifySendError(result.error ?? '', channel),
          error: sanitizeProviderError(result.error, 300),
        },
      })
    }
    results.push({ channel, ok: result.ok, error: result.error })
  }

  if (results.length === 0) return json({ ok: false, error: 'no_channels' })
  return json({ ok: results.some((r) => r.ok), count: totalCount, results })
})

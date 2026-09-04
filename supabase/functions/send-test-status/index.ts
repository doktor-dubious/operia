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
import {
  CHANNEL_FEATURES,
  CHANNEL_OPTION_COLUMNS,
  CHANNEL_TOGGLE_COLUMNS,
  allTemplateKeys,
  enabledChannels,
  recipientFor,
  selectedChannels,
  renderFor,
  sendVia,
  templateKeyFor,
  type Channel,
} from '../_shared/channels.ts'
import {
  DAY,
  classifySendError,
  copenhagenDate,
  maskRecipient,
  resolveTemplate,
  sanitizeProviderError,
} from '../_shared/notify.ts'
import {
  DELIVERED_STATUS,
  OPEN_STATUSES,
  PARCEL_SELECT,
  STATUS_BASE_KEY,
  TEST_DIGEST_PREFIX,
  buildUnits,
  deliveredItems,
  digestCount,
  digestItems,
  digestTokens,
  groupUnitsByEmployee,
  parseDigestHistory,
  widestDigestWindowStart,
  type ParcelRow,
} from '../_shared/parcel-digest.ts'
import { callerCanManageCompany } from '../_shared/user-admin.ts'
import { companySecretLookup } from '../_shared/company-secret.ts'

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

// Statusbeskedens skabelonnøgler på tværs af kanaler ('package_status',
// 'package_status_sms', …) — hentes i ét opslag som i dispatcheren.
const STATUS_TEMPLATE_KEYS = allTemplateKeys([STATUS_BASE_KEY])

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
    .select(`parcel_notifications_enabled, ${CHANNEL_TOGGLE_COLUMNS}`)
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
      .in('key', STATUS_TEMPLATE_KEYS),
    admin
      .from('company_templates')
      .select('company_id, key, lang, title, body')
      .in('key', STATUS_TEMPLATE_KEYS)
      .eq('company_id', companyId),
  ])

  const batchCounts = new Map<string, number>()
  for (const r of batchMemberRes.data ?? []) {
    batchCounts.set(r.batch_id, (batchCounts.get(r.batch_id) ?? 0) + 1)
  }
  const { lastDigestAt } = parseDigestHistory(digestRes.data ?? [], today)

  // Kanaler med et tilvalg (SMS/Slack) kræver at kunden har det — samme regel
  // som i dispatcheren, hentet gennem det samme register.
  const { data: featRows } = await admin
    .from('company_features')
    .select('feature_key, valid_until')
    .eq('company_id', companyId)
    .in('feature_key', CHANNEL_FEATURES)
  const feats = new Set(
    (featRows ?? [])
      .filter((f) => f.valid_until == null || f.valid_until >= today)
      .map((f) => f.feature_key),
  )

  const { data: company } = await admin
    .from('companies')
    .select(`${CHANNEL_TOGGLE_COLUMNS}, ${CHANNEL_OPTION_COLUMNS}`)
    .eq('id', companyId)
    .maybeSingle()
  // Navngivet cfg*/ ikke co*: 'co' er allerede virksomhedsrækken fra
  // sammendragsgruppen længere nede i funktionen.
  const cfgCompany = company as unknown as Record<string, unknown> | null
  const cfgPlatform = platform as unknown as Record<string, unknown>
  const channels = enabledChannels(cfgCompany, cfgPlatform, feats)
  // Kanaler manageren har krydset af, men som kunden ikke har tilvalget til.
  // Uden denne skelnen ville svaret sige "ingen kanaler valgt" om en kanal der
  // netop ER valgt.
  const missingAddon = selectedChannels(cfgCompany, cfgPlatform).filter(
    (c) => !channels.includes(c),
  )

  // 5) Byg sammendragene pr. modtager — kun dem der faktisk har noget at melde
  //    (ventende pakker, udleverede pakker, eller begge dele). Vinduet er pr.
  //    kanal i dispatcheren; her vises det VIDESTE over de aktive kanaler, så
  //    forhåndsvisningen ikke skjuler pakker en udskudt kanal stadig skylder.
  const pending = groupUnitsByEmployee(buildUnits(parcels, batchCounts), delivered)
    .map((g) => {
      const since = widestDigestWindowStart(lastDigestAt, g.emp.id, channels, nowMs)
      return { g, items: digestItems(g.units, since), handed: deliveredItems(g.delivered, since) }
    })
    .filter((x) => x.items.length > 0 || x.handed.length > 0)

  if (mode === 'preview') {
    return json({
      ok: true,
      channels,
      notificationsEnabled: platform.parcel_notifications_enabled,
      candidates: pending.map(({ g, items, handed }) => ({
        employeeId: g.emp.id,
        name: g.emp.full_name,
        // E-mail/telefon vises i dialogen. Teams' adresse (Entra-objekt-id) og
        // Slacks opslagsnøgle sendes bevidst IKKE med: et objekt-id siger en
        // manager intet, og en identifikator hører ikke hjemme i et svar der
        // kun skal vise "kan personen nås".
        email: g.emp.email,
        phone: g.emp.phone,
        reachable: channels.filter((c) => recipientFor(c, g.emp, cfgCompany) !== null),
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

  // `reason` er den korte maskinkode fra classifySendError — den samme som
  // Logs viser. Uden den havde svaret kun en fri fejltekst, og dialogen faldt
  // tilbage på "unknown" når ALLE kanaler fejlede (der er intet felt på
  // topniveau i det tilfælde).
  const results: { channel: Channel; ok: boolean; error?: string; reason?: string }[] = []
  for (const channel of channels) {
    const to = recipientFor(channel, emp, cfgCompany)
    if (!to) {
      results.push({ channel, ok: false, error: 'no_recipient', reason: 'no_recipient' })
      continue
    }
    const { title, body: tplBody } = resolveTemplate(
      ptplRes.data ?? [],
      ctplRes.data ?? [],
      companyId,
      templateKeyFor(channel, STATUS_BASE_KEY),
      lang,
    )
    if (!tplBody) {
      results.push({ channel, ok: false, error: 'no_template', reason: 'no_template' })
      continue
    }

    // Testsendinger logges med 'test-'-præfiks i digest_key og tæller derfor
    // ikke mod MAX_ATTEMPTS (se parseDigestHistory) — en forbigående fejl må
    // gerne skrives her, modsat i dispatcheren, og manageren skal SE den.
    const result = await sendVia(channel, to, renderFor(channel, title, tplBody, tokens), {
      companyId,
      companySecret: companySecretLookup(admin, companyId),
    })

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
          recipient: maskRecipient(to, channel),
          reason: classifySendError(result.error ?? '', channel),
          error: sanitizeProviderError(result.error, 300),
        },
      })
    }
    results.push({
      channel,
      ok: result.ok,
      error: result.error,
      reason: result.ok ? undefined : classifySendError(result.error ?? '', channel),
    })
  }

  if (results.length === 0) {
    return missingAddon.length
      ? json({ ok: false, error: 'missing_addon', channels: missingAddon })
      : json({ ok: false, error: 'no_channels' })
  }
  return json({ ok: results.some((r) => r.ok), count: totalCount, results })
})

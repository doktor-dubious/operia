// dispatch-parcel-notifications — kaldt af pg_cron. Finder åbne pakker der mangler
// en ankomst-/påmindelses-notifikation, respekterer stilletid, påmindelsesdage/
// toggles/max, entitlements og kanalvalg, renderer skabelonen i modtagerens sprog
// og sender via de kanaler kunden har slået til. Hver afsendelse logges i
// parcel_notifications (NIS2-revisionsspor + dedup + tælling mod max).
//
// Kanalerne er IKKE kendt her: adressefelt, skabelonnøgle, rendering og afsender
// slås op i _shared/channels.ts. Skal der en kanal mere til, beskrives den dér
// (plus enum, skabeloner og til/fra-kolonne i en migration) — denne fil skal
// ikke røres.
//
// Batch: pakker i en 'finished' batch behandles som ÉN enhed — én besked med et
// {{count}}-token i stedet for én pr. pakke. Dedup sker på batch-niveau
// (parcel_notifications.batch_id), så en batch aldrig sender 25 beskeder. Pakker i
// en 'open' batch springes over (der notificeres først når batchen er afsluttet).
//
// Statusbesked: et dagligt sammendrag. På virksomhedens valgte klokkeslæt samles
// alt der er ankommet til samme modtager SIDEN sidste statusbesked i ÉN besked
// (skabelon package_status). Dedup sker pr. modtager/kanal/lokal dag via
// parcel_notifications.digest_key. Uafhængig af ankomst/påmindelser: er begge
// slået til, får modtageren både den enkelte ankomstbesked og sammendraget.
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
//     pakke/batch (reminder_1 + reminder_2). Interval-baserede gentagelser er en
//     senere udvidelse.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import {
  CHANNEL_FEATURES,
  allTemplateKeys,
  enabledChannels,
  recipientFor,
  renderFor,
  sendVia,
  templateKeyFor,
  type Channel,
} from '../_shared/channels.ts'
import { companySecretLookup } from '../_shared/company-secret.ts'
import {
  DAY,
  classifySendError,
  copenhagenDate,
  copenhagenMinutes,
  fmtDate,
  inQuietHours,
  isServiceRole,
  maskRecipient,
  resolveTemplate,
  timeToMinutes,
  sanitizeProviderError,
} from '../_shared/notify.ts'
import {
  DELIVERED_STATUS,
  OPEN_STATUSES,
  PARCEL_SELECT,
  STATUS_BASE_KEY,
  buildUnits,
  deliveredItems,
  digestCount,
  digestItems,
  digestTokens,
  digestWindowStart,
  groupUnitsByEmployee,
  parseDigestHistory,
  type DigestHistoryRow,
  type ParcelRow,
} from '../_shared/parcel-digest.ts'

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

const ARRIVAL_MAX_AGE_DAYS = 2
const LOOKBACK_DAYS = 60
const MAX_PARCELS = 200
const MAX_ATTEMPTS = 3 // giv op efter så mange fejlede forsøg pr. type/kanal
// Udskydelser (forbigående fejl) noteres i Logs højst så ofte pr. kunde/kanal,
// så et længere udfald hos udbyderen giver ét spor i timen — ikke ét pr. kørsel
// hvert 5. minut, og heller ikke ingenting.
const DEFERRAL_NOTE_INTERVAL_MS = 60 * 60_000
// Hvor langt tilbage statusbeskedens historik læses (til "siden sidste
// statusbesked" og dagens dedup). Rigeligt til at finde den seneste udsendelse.
const DIGEST_LOOKBACK_DAYS = 30

// Statushistorikken hentes i sider: PostgREST klipper ellers stiltiende ved
// max_rows (1000), og en afklippet historik ligner "aldrig sendt" → dobbelte
// sammendrag samme dag. Stabil orden (created_at, id) så siderne ikke
// overlapper. Fejler opslaget, afbrydes kørslen — en tom historik må aldrig
// antages.
async function fetchDigestHistory(
  admin: SupabaseClient,
  companyIds: string[],
  sinceIso: string,
): Promise<DigestHistoryRow[]> {
  const PAGE = 1000
  const rows: DigestHistoryRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('parcel_notifications')
      .select('employee_id, channel, status, digest_key, created_at, id')
      .eq('kind', 'status')
      .in('company_id', companyIds)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as unknown as DigestHistoryRow[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

type Kind = 'arrival' | 'reminder_1' | 'reminder_2'

// Basisnøgler pr. type. Kanalens faktiske skabelonnøgle udledes af basen +
// kanalens suffiks (templateKeyFor), så en ny kanal ikke kræver endnu et
// Record her — den arver hele nøglesættet automatisk.
const BASE_KEY: Record<Kind, string> = {
  arrival: 'package_arrival',
  reminder_1: 'package_reminder_1',
  reminder_2: 'package_reminder_2',
}
// Batch-varianter (med {{count}}/{{batch_code}}) bruges når enheden er en batch.
const BASE_KEY_BATCH: Record<Kind, string> = {
  arrival: 'package_arrival_batch',
  reminder_1: 'package_reminder_1_batch',
  reminder_2: 'package_reminder_2_batch',
}

const ALL_TEMPLATE_KEYS = allTemplateKeys([
  ...Object.values(BASE_KEY),
  ...Object.values(BASE_KEY_BATCH),
  STATUS_BASE_KEY,
])

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
      'quiet_hours_start, quiet_hours_end, parcel_reminder_1_days, parcel_reminder_2_days, parcel_reminder_max, parcel_reminder_1_enabled, parcel_reminder_2_enabled, parcel_arrival_enabled, parcel_status_enabled, parcel_status_time, notify_email_enabled, notify_sms_enabled, notify_teams_enabled, notify_slack_enabled, parcel_notifications_enabled',
    )
    .limit(1)
    .maybeSingle()
  if (!platform) return json({ error: 'no_platform_settings' }, 500)
  if (!platform.parcel_notifications_enabled) return json({ ok: true, disabled: true })

  const nowMs = Date.now()
  const nowMin = copenhagenMinutes(new Date(nowMs))
  const today = copenhagenDate(new Date(nowMs))

  // Kandidat-pakker: åbne, med aktiv modtager, nyere end lookback.
  // Dertil de UDLEVEREDE — statusbeskeden rapporterer også hvad der er hentet
  // siden sidst. De hentes for sig, fordi de er ude af OPEN_STATUSES og
  // afgrænses på udleveringstidspunktet, ikke på registreringen.
  const [parcelRes, deliveredRes] = await Promise.all([
    admin
      .from('parcels')
      .select(PARCEL_SELECT)
      .in('status', OPEN_STATUSES)
      .not('receiver_employee_id', 'is', null)
      .gte('registered_at', new Date(nowMs - LOOKBACK_DAYS * DAY).toISOString())
      .order('registered_at', { ascending: true })
      .limit(MAX_PARCELS),
    admin
      .from('parcels')
      .select(PARCEL_SELECT)
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
  if (parcels.length === 0 && delivered.length === 0) {
    return json({ ok: true, processed: 0, sent: 0, failed: 0 })
  }

  const parcelIds = parcels.map((p) => p.id)
  const companyIds = [...new Set([...parcels, ...delivered].map((p) => p.company_id))]
  // Batches der er afsluttede og repræsenteret i kandidatsættet.
  const finishedBatchIds = [
    ...new Set(
      parcels.filter((p) => p.batch_id && p.batch?.status === 'finished').map((p) => p.batch_id as string),
    ),
  ]

  // Entitlements + eksisterende sendinger + skabeloner + batch-optælling.
  const validUntilOk = (v: string | null) => v == null || v >= today
  const [prodRes, featRes, notifRes, batchNotifRes, batchMemberRes, digestRes, ptplRes, ctplRes] = await Promise.all([
    admin.from('company_products').select('company_id, valid_until').eq('product_key', 'parcels').in('company_id', companyIds),
    admin.from('company_features').select('company_id, feature_key, valid_until').in('feature_key', ['reminders', ...CHANNEL_FEATURES]).in('company_id', companyIds),
    admin.from('parcel_notifications').select('parcel_id, batch_id, kind, channel, status').in('parcel_id', parcelIds),
    // Batch-dedup slås op på batch_id direkte (robust mod at repræsentanten skifter,
    // hvis en enkelt pakke i batchen udleveres og forlader OPEN_STATUSES).
    finishedBatchIds.length
      ? admin.from('parcel_notifications').select('batch_id, kind, channel, status').in('batch_id', finishedBatchIds)
      : Promise.resolve({ data: [] as { batch_id: string; kind: string; channel: string; status: string }[] }),
    finishedBatchIds.length
      ? admin.from('parcels').select('batch_id').in('batch_id', finishedBatchIds)
      : Promise.resolve({ data: [] as { batch_id: string }[] }),
    // Statusbeskedens historik: hvornår fik hver modtager sidst et sammendrag
    // (vinduets start) og er dagens allerede sendt/fejlet (dedup + forsøgsloft).
    // Slås op pr. virksomhed — modtagerlisten kan først bygges nedenfor.
    // Pagineres: uden det klipper PostgREST stiltiende ved max_rows (1000), og
    // en afklippet historik giver dobbelte sammendrag samme dag.
    fetchDigestHistory(admin, companyIds, new Date(nowMs - DIGEST_LOOKBACK_DAYS * DAY).toISOString()),
    admin.from('platform_templates').select('key, lang, title, body').in('key', ALL_TEMPLATE_KEYS),
    admin.from('company_templates').select('company_id, key, lang, title, body').in('key', ALL_TEMPLATE_KEYS).in('company_id', companyIds),
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

  // Antal pakker pr. batch (til {{count}} i beskeden — hele den modtagne batch).
  const batchCounts = new Map<string, number>()
  for (const r of batchMemberRes.data ?? []) {
    batchCounts.set(r.batch_id, (batchCounts.get(r.batch_id) ?? 0) + 1)
  }

  // Allerede afsendt / fejlet pr. (enhed, type, kanal). Enhed = batch_id for
  // batch-rækker, ellers parcel_id. Batch-rækker læses KUN fra batchNotifRes for
  // ikke at tælle dobbelt (samme række dukker også op i notifRes via repræsentanten).
  const sentSet = new Set<string>()
  const failedCount = new Map<string, number>()
  const sentReminderKinds = new Map<string, Set<string>>()
  const absorb = (id: string, kind: string, channel: string, status: string) => {
    const key = `${id}:${kind}:${channel}`
    if (status === 'sent') {
      sentSet.add(key)
      // Kun ægte påmindelser tæller mod parcel_reminder_max. Statussammendrag
      // logges med en repræsentant-pakke (kind='status') og må ikke æde en
      // påmindelsesanledning for netop dén pakke.
      if (kind === 'reminder_1' || kind === 'reminder_2') {
        if (!sentReminderKinds.has(id)) sentReminderKinds.set(id, new Set())
        sentReminderKinds.get(id)!.add(kind)
      }
    } else if (status === 'failed') {
      failedCount.set(key, (failedCount.get(key) ?? 0) + 1)
    }
  }
  for (const r of notifRes.data ?? []) {
    if (r.batch_id) continue // batch-rækker håndteres via batchNotifRes
    absorb(r.parcel_id, r.kind, r.channel, r.status)
  }
  for (const r of batchNotifRes.data ?? []) {
    absorb(r.batch_id, r.kind, r.channel, r.status)
  }

  // Statusbeskedens tilstand pr. modtager: seneste gennemførte sammendrag
  // (vinduets start) + dagens sendte/fejlede pr. kanal.
  const { lastDigestAt, digestSent, digestFailed } = parseDigestHistory(digestRes, today)

  const units = buildUnits(parcels, batchCounts)

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
  // Forbigående fejl (rate limit, 5xx): hverken sendt eller logget som failed —
  // beskeden står uændret og forsøges igen ved næste kørsel. Men IKKE sporløst:
  //
  //   • Første forbigående fejl på en (kunde, kanal) STOPPER resten af kundens
  //     sendinger på den kanal i denne kørsel. Et 429 fra Slack betyder at
  //     hvert efterfølgende kald blot forlænger pausen og stjæler kvote fra de
  //     modtagere der kunne nås.
  //   • Hver kørsel skriver en advarsel pr. berørt (kunde, kanal) til Logs
  //     ('parcel.notifications_deferred'), dog højst én i timen — så et udfald
  //     ses af manageren, uden at aktivitetsloggen drukner.
  //   • Alt logges også til funktionens konsol (edge-loggen).
  let deferred = 0
  const halted = new Map<string, { count: number; error: string; companyId: string; channel: Channel }>()
  const haltKey = (companyId: string, channel: Channel) => `${companyId}:${channel}`
  const defer = (companyId: string, channel: Channel, error: string | undefined) => {
    deferred++
    const key = haltKey(companyId, channel)
    const h = halted.get(key)
    if (h) h.count++
    else {
      halted.set(key, { count: 1, error: error ?? '', companyId, channel })
      console.warn(`deferred ${channel} for company ${companyId}: ${sanitizeProviderError(error, 300)}`)
    }
  }

  for (const u of units) {
    const p = u.parcel
    const emp = u.emp
    const co = u.co
    if (!productOk.has(p.company_id)) continue

    const feats = featureMap.get(p.company_id) ?? new Set<string>()
    const hasReminders = feats.has('reminders')

    // Effektive indstillinger: virksomhedens override, ellers platformens.
    const arrivalOn = co.parcel_arrival_enabled ?? platform.parcel_arrival_enabled
    const r1on = co.parcel_reminder_1_enabled ?? platform.parcel_reminder_1_enabled
    const r2on = (co.parcel_reminder_2_enabled ?? platform.parcel_reminder_2_enabled) && r1on
    const r1days = co.parcel_reminder_1_days ?? platform.parcel_reminder_1_days ?? 3
    const r2days = co.parcel_reminder_2_days ?? platform.parcel_reminder_2_days ?? 7
    const max = co.parcel_reminder_max ?? platform.parcel_reminder_max ?? 0
    const qStart = co.quiet_hours_start ?? platform.quiet_hours_start
    const qEnd = co.quiet_hours_end ?? platform.quiet_hours_end

    const channels = enabledChannels(co, platform, feats)
    if (channels.length === 0) continue

    // Stilletid: udskyd hele enheden til efter det stille vindue (næste kørsel).
    if (inQuietHours(nowMin, qStart, qEnd)) {
      skippedQuiet++
      continue
    }

    const lang = emp.language || co.default_language || 'da'
    const ageDays = (nowMs - Date.parse(p.registered_at)) / DAY

    const candidates: Kind[] = []
    if (arrivalOn && ageDays <= ARRIVAL_MAX_AGE_DAYS) candidates.push('arrival')
    if (hasReminders && r1on && ageDays >= r1days) candidates.push('reminder_1')
    if (hasReminders && r2on && ageDays >= r2days) candidates.push('reminder_2')
    if (candidates.length === 0) continue

    const isBatch = u.batchId != null
    const tokens: Record<string, string> = {
      recipient_name: emp.full_name ?? '',
      barcode: p.barcode ?? '',
      date: fmtDate(p.registered_at, lang),
      company_name: co.name ?? '',
      count: String(u.count),
      batch_code: u.batchCode ?? '',
    }

    let remCount = sentReminderKinds.get(u.key)?.size ?? 0
    let touched = false

    for (const kind of candidates) {
      const isReminder = kind !== 'arrival'
      if (isReminder && max > 0 && remCount >= max) continue
      let occasionSent = false

      for (const channel of channels) {
        const key = `${u.key}:${kind}:${channel}`
        if (sentSet.has(key)) continue
        if ((failedCount.get(key) ?? 0) >= MAX_ATTEMPTS) continue

        const to = recipientFor(channel, emp, co)
        if (!to) continue

        const base = isBatch ? BASE_KEY_BATCH[kind] : BASE_KEY[kind]
        const { title, body } = tpl(p.company_id, templateKeyFor(channel, base), lang)
        if (!body) continue // ingen skabelon → send ikke tomt

        // Kanalen er allerede i pause for kunden i denne kørsel — kald ikke.
        if (halted.has(haltKey(p.company_id, channel))) {
          defer(p.company_id, channel, undefined)
          continue
        }

        const result = await sendVia(channel, to, renderFor(channel, title, body, tokens), {
          companyId: p.company_id,
          companySecret: companySecretLookup(admin, p.company_id),
        })

        // Forbigående fejl: ingen 'failed'-række — den ville tælle mod
        // MAX_ATTEMPTS, og tre rate limits i træk ville opgive beskeden for
        // evigt. Sporet skrives samlet efter løkkerne (se `halted`).
        if (!result.ok && result.retryable) {
          defer(p.company_id, channel, result.error)
          continue
        }

        touched = true
        await admin.from('parcel_notifications').insert({
          company_id: p.company_id,
          parcel_id: p.id,
          batch_id: u.batchId,
          employee_id: emp.id,
          kind,
          channel,
          lang,
          recipient: to,
          status: result.ok ? 'sent' : 'failed',
          provider_id: result.id ?? null,
          error: result.ok ? null : sanitizeProviderError(result.error, 500),
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
            p_summary: `${u.batchCode || p.barcode || '—'}`,
            p_detail: {
              channel,
              kind,
              batch: isBatch,
              recipient: maskRecipient(to, channel),
              reason: classifySendError(result.error ?? '', channel),
              error: sanitizeProviderError(result.error, 300),
            },
          })
        }
      }

      if (isReminder && occasionSent) remCount++
    }

    if (touched) processed++
  }

  // ── Statusbesked: ét dagligt sammendrag pr. modtager ───────────────────────
  // Samler de enheder (pakker/afsluttede batches) der er ankommet siden
  // modtagerens sidste statusbesked. Sendes tidligst på virksomhedens valgte
  // klokkeslæt og højst én gang pr. lokal dag (digest_key). Har modtageren
  // intet nyt siden sidst, sendes ingenting — ingen "du har 0 pakker".
  let statusSent = 0
  for (const g of groupUnitsByEmployee(units, delivered)) {
    const co = g.co
    const emp = g.emp
    if (!productOk.has(co.id)) continue
    if (!(co.parcel_status_enabled ?? platform.parcel_status_enabled)) continue

    // Klokkeslættet er lokal tid (Europe/Copenhagen), som stilletiden. Kørslen
    // hvert 5. minut betyder "på eller efter det valgte tidspunkt i dag".
    const statusMin = timeToMinutes(co.parcel_status_time ?? platform.parcel_status_time)
    if (statusMin == null || nowMin < statusMin) continue

    const qStart = co.quiet_hours_start ?? platform.quiet_hours_start
    const qEnd = co.quiet_hours_end ?? platform.quiet_hours_end
    if (inQuietHours(nowMin, qStart, qEnd)) {
      skippedQuiet++
      continue
    }

    const feats = featureMap.get(co.id) ?? new Set<string>()
    const channels = enabledChannels(co, platform, feats)
    if (channels.length === 0) continue

    const lang = emp.language || co.default_language || 'da'

    for (const channel of channels) {
      const key = `${emp.id}:${channel}`
      if (digestSent.has(key)) continue
      if ((digestFailed.get(key) ?? 0) >= MAX_ATTEMPTS) continue

      const to = recipientFor(channel, emp, co)
      if (!to) continue

      // Vinduet er pr. kanal (se parseDigestHistory): en udskudt kanal skylder
      // stadig alt siden SIT seneste sammendrag, ikke siden e-mailens.
      const since = digestWindowStart(lastDigestAt, emp.id, channel, nowMs)
      const items = digestItems(g.units, since)
      const handed = deliveredItems(g.delivered, since)
      if (items.length === 0 && handed.length === 0) continue

      const count = digestCount(items) + digestCount(handed)
      const tokens = digestTokens(items, handed, emp, co, lang, nowMs)
      // Repræsentativ pakke (parcel_id er not null i loggen) — den ældste i
      // sammendraget. Vinduet gør at samme pakke aldrig indgår i to sammendrag.
      const repParcelId = (items[0] ?? handed[0]).parcel.id

      const { title, body } = tpl(co.id, templateKeyFor(channel, STATUS_BASE_KEY), lang)
      if (!body) continue

      if (halted.has(haltKey(co.id, channel))) {
        defer(co.id, channel, undefined)
        continue
      }

      const result = await sendVia(channel, to, renderFor(channel, title, body, tokens), {
        companyId: co.id,
        companySecret: companySecretLookup(admin, co.id),
      })
      if (!result.ok && result.retryable) {
        defer(co.id, channel, result.error)
        continue
      }

      await admin.from('parcel_notifications').insert({
        company_id: co.id,
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
        digest_key: today,
      })

      if (result.ok) {
        sent++
        statusSent++
        digestSent.add(key)
      } else {
        failed++
        digestFailed.set(key, (digestFailed.get(key) ?? 0) + 1)
        await admin.rpc('log_notification_event', {
          p_company_id: co.id,
          p_action: 'parcel.reminder_failed',
          p_entity_type: 'parcel',
          p_entity_id: repParcelId,
          p_summary: `${count}`,
          p_detail: {
            channel,
            kind: 'status',
            batch: false,
            recipient: maskRecipient(to, channel),
            reason: classifySendError(result.error ?? '', channel),
            error: sanitizeProviderError(result.error, 300),
          },
        })
      }
    }
  }

  // ── Spor efter udskydelser ─────────────────────────────────────────────────
  // Én advarsel pr. berørt (kunde, kanal), højst én i timen: findes der en
  // nyere note i audit_log, springes den over. Uden dette spor ville et
  // udfald hos udbyderen på >2 dage tabe ankomstbeskederne (ARRIVAL_MAX_AGE_DAYS)
  // uden at nogen kunne se det i Logs.
  for (const h of halted.values()) {
    const sinceIso = new Date(nowMs - DEFERRAL_NOTE_INTERVAL_MS).toISOString()
    const { data: recent } = await admin
      .from('audit_log')
      .select('id')
      .eq('company_id', h.companyId)
      .eq('action', 'parcel.notifications_deferred')
      .eq('detail->>channel', h.channel)
      .gte('created_at', sinceIso)
      .limit(1)
    if (recent && recent.length > 0) continue
    await admin.rpc('log_notification_event', {
      p_company_id: h.companyId,
      p_action: 'parcel.notifications_deferred',
      p_entity_type: 'company',
      p_entity_id: h.companyId,
      p_summary: `${h.count}`,
      p_detail: {
        channel: h.channel,
        deferred: h.count,
        reason: classifySendError(h.error, h.channel),
        error: sanitizeProviderError(h.error, 300),
      },
    })
  }

  return json({
    ok: true,
    processed,
    sent,
    failed,
    deferred,
    statusSent,
    skippedQuiet,
    candidates: units.length,
  })
})

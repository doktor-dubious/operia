// dispatch-booking-notifications — kaldt af pg_cron hvert 5. minut.
// Bekræfter oprettelse og ændring af bookinger, varsler annullering, minder om
// bookinger der snart begynder, og giver økonomipostkassen besked når en
// booking er sendt til fakturering (EVU-krav A-04).
//
// HVOR ARBEJDET KOMMER FRA
//
// De fire hændelsesbeskeder læses ud af `booking_events` — den append-only log
// RPC'erne allerede skriver. Det er en outbox uden at være bygget som én: den
// kan ikke komme ud af trit med virkeligheden (samme transaktion som selve
// ændringen), den holder rækkefølgen, og en booking der ændres ti gange giver
// ti hændelser og dermed ti bekræftelser — hver med sit eget dedup-anker.
// Påmindelsen har ingen hændelse og findes ved at kigge frem i kalenderen.
//
// Autoriseres som service-role, som de øvrige dispatchere. Hovedafbryderen
// platform_settings.booking_notifications_enabled skal være slået til.
//
// GRÆNSER OG HVORFOR
//
//   • EVENT_MAX_AGE_MIN — en hændelse ældre end dette varsles ikke. Uden den
//     ville et bagkatalog blive sendt på én gang, første gang en kunde slår
//     booking-notifikationer til. Prisen er, at et længere cron-udfald koster
//     de bekræftelser der lå i vinduet; det er den rigtige vej at fejle for en
//     kvittering.
//   • En ÆNDRING der ikke flytter ressource, medarbejder eller tid giver ingen
//     besked. update_booking skriver en hændelse ved hvert gem — også ved en
//     rettet stavefejl i formålet — og en mail pr. gem ville lære modtageren at
//     filtrere hele serien væk.
//   • En booking oprettet EFTER den var afholdt (efterregistrering, som
//     bookingproduktet tillader) bekræftes ikke: der er intet at varsle om.
//   • Påmindelsen sendes kun hvis påmindelsestidspunktet lå efter oprettelsen.
//     Ellers ville en booking oprettet to timer før start udløse bekræftelse og
//     påmindelse i samme kørsel.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  CHANNEL_OPTION_COLUMNS,
  CHANNEL_TOGGLE_COLUMNS,
  enabledChannels,
  recipientFor,
  renderFor,
  sendVia,
  templateKeyFor,
  allTemplateKeys,
  type Channel,
  type ChannelRecipient,
} from '../_shared/channels.ts'
import { companySecretLookup } from '../_shared/company-secret.ts'
import {
  bookingTimeLabel,
  classifySendError,
  copenhagenDate,
  copenhagenMinutes,
  inQuietHours,
  isServiceRole,
  maskRecipient,
  resolveTemplate,
  sanitizeProviderError,
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

const EVENT_MAX_AGE_MIN = 180 // 3 timer: rummer et par fejlede cron-kørsler
// Sidestørrelse for de tre opslag der kan vokse (hændelser, kommende bookinger,
// beskedloggen). Et fast `limit` ville lade de ÆLDSTE rækker skygge for de nye:
// 300 ignorerede faktureringshændelser i vinduet, og en ny booking bag dem blev
// aldrig bekræftet. Så vi bladrer til bunds i stedet — samme mønster som
// pakke-dispatcherens digest-historik.
const PAGE = 1000
const MAX_REMINDER_HOURS = 336 // = companies_booking_reminder_hours_check
const MAX_ATTEMPTS = 3
const HOUR = 3_600_000

type Kind = 'created' | 'updated' | 'cancelled' | 'reminder' | 'invoiced'
type Audience = 'employee' | 'booker' | 'copy' | 'economy'

// Hændelsestype i booking_events → beskedart. Hændelser uden en art her
// (fx 'invoice_cleared') giver ingen besked.
const EVENT_KIND: Record<string, Kind> = {
  created: 'created',
  updated: 'updated',
  cancelled: 'cancelled',
  invoiced: 'invoiced',
}

const BASE_KEY: Record<Kind, string> = {
  created: 'booking_created',
  updated: 'booking_updated',
  cancelled: 'booking_cancelled',
  reminder: 'booking_reminder',
  invoiced: 'booking_invoiced',
}

const ALL_TEMPLATE_KEYS = allTemplateKeys(Object.values(BASE_KEY))

type PlatformRow = Record<string, unknown> & {
  booking_notifications_enabled: boolean
  booking_created_enabled: boolean
  booking_updated_enabled: boolean
  booking_cancelled_enabled: boolean
  booking_reminder_enabled: boolean
  booking_reminder_hours: number
  booking_invoiced_enabled: boolean
  booking_notify_booker: boolean
  quiet_hours_start: string | null
  quiet_hours_end: string | null
}

type CompanyRow = Record<string, unknown> & {
  id: string
  name: string | null
  default_language: string | null
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  booking_created_enabled: boolean | null
  booking_updated_enabled: boolean | null
  booking_cancelled_enabled: boolean | null
  booking_reminder_enabled: boolean | null
  booking_reminder_hours: number | null
  booking_invoiced_enabled: boolean | null
  booking_notify_booker: boolean | null
  booking_copy_email: string | null
  booking_invoice_email: string | null
}

type EmployeeRow = ChannelRecipient & {
  id: string
  full_name: string | null
  language: string | null
  user_id: string | null
}

type BookingRow = {
  id: string
  company_id: string
  resource_id: string
  employee_id: string | null
  booked_by: string | null
  starts_at: string
  ends_at: string
  all_day: boolean
  title: string | null
  status: string
  invoiced_at: string | null
  created_at: string
  resource: { name: string | null } | null
  employee: EmployeeRow | null
}

type EventRow = {
  id: number
  booking_id: string
  company_id: string
  event_type: string
  detail: Record<string, unknown>
  created_at: string
  booking: BookingRow | null
}

const COMPANY_COLUMNS =
  `id, name, default_language, quiet_hours_start, quiet_hours_end,
   booking_created_enabled, booking_updated_enabled, booking_cancelled_enabled,
   booking_reminder_enabled, booking_reminder_hours, booking_invoiced_enabled,
   booking_notify_booker, booking_copy_email, booking_invoice_email,
   ${CHANNEL_TOGGLE_COLUMNS}, ${CHANNEL_OPTION_COLUMNS}`

const BOOKING_COLUMNS =
  `id, company_id, resource_id, employee_id, booked_by, starts_at, ends_at, all_day,
   title, status, invoiced_at, created_at,
   resource:booking_resources (name),
   employee:employees (id, full_name, language, email, phone, external_id, slack_user_id, user_id)`

/** Flyttede ændringen noget en modtager skal vide? (Se hovedkommentaren.) */
function movesSomething(detail: Record<string, unknown>): boolean {
  const pairs = [
    ['from_resource_id', 'to_resource_id'],
    ['from_employee_id', 'to_employee_id'],
    ['from_starts_at', 'to_starts_at'],
    ['from_ends_at', 'to_ends_at'],
  ]
  return pairs.some(([a, b]) => {
    const x = detail[a]
    const y = detail[b]
    // Tidsstempler kan komme tilbage i forskellig tekstform for samme øjeblik.
    if (typeof x === 'string' && typeof y === 'string' && a.endsWith('_at')) {
      return Date.parse(x) !== Date.parse(y)
    }
    return x !== y
  })
}

/**
 * Blader et PostgREST-opslag til bunds. `build` skal returnere en NY builder
 * hver gang (med stabil orden), da .range() ikke kan genbruges på tværs af
 * sider. Fejler en side, kastes — en afklippet liste må aldrig blive til
 * "ingen arbejde" eller "aldrig sendt".
 */
async function fetchAll<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!isServiceRole(token, serviceKey)) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: platformRow } = await admin
    .from('platform_settings')
    .select(
      `booking_notifications_enabled, booking_created_enabled, booking_updated_enabled,
       booking_cancelled_enabled, booking_reminder_enabled, booking_reminder_hours,
       booking_invoiced_enabled, booking_notify_booker,
       quiet_hours_start, quiet_hours_end, ${CHANNEL_TOGGLE_COLUMNS}`,
    )
    .limit(1)
    .maybeSingle()
  if (!platformRow) return json({ error: 'no_platform_settings' }, 500)
  const platform = platformRow as unknown as PlatformRow
  if (!platform.booking_notifications_enabled) return json({ ok: true, disabled: true })

  const nowMs = Date.now()
  const nowMin = copenhagenMinutes(new Date(nowMs))
  const today = copenhagenDate(new Date(nowMs))
  const validUntilOk = (v: string | null) => v == null || v >= today

  // Virksomhederne er få (én tabelrække pr. kunde) — hentes samlet, så
  // hændelses- og påmindelsesløkkerne kan slå op uden flere rundture.
  const { data: coData, error: coErr } = await admin.from('companies').select(COMPANY_COLUMNS)
  if (coErr) return json({ error: 'query_failed', detail: coErr.message }, 500)
  const companies = new Map<string, CompanyRow>(
    ((coData ?? []) as unknown as CompanyRow[]).map((c) => [c.id, c]),
  )

  // Booking-produktet er forudsætningen (som parcels/assets for de øvrige).
  const { data: prodData } = await admin
    .from('company_products')
    .select('company_id, valid_until')
    .eq('product_key', 'booking')
  const productOk = new Set(
    (prodData ?? []).filter((r) => validUntilOk(r.valid_until)).map((r) => r.company_id),
  )
  if (productOk.size === 0) return json({ ok: true, processed: 0, sent: 0, failed: 0 })

  const { data: featData } = await admin
    .from('company_features')
    .select('company_id, feature_key, valid_until')
  const featureMap = new Map<string, Set<string>>()
  for (const f of featData ?? []) {
    if (!validUntilOk(f.valid_until)) continue
    if (!featureMap.has(f.company_id)) featureMap.set(f.company_id, new Set())
    featureMap.get(f.company_id)!.add(f.feature_key)
  }

  const eff = <T>(co: CompanyRow, key: keyof CompanyRow, fallback: T): T =>
    (co[key] ?? (platform as Record<string, unknown>)[key] ?? fallback) as T

  // ------------------------------------------------------------------
  // Arbejdsemner: hændelser + påmindelser, samlet i én liste, så
  // afsendelsesløkken kun findes ét sted.
  // ------------------------------------------------------------------
  type Unit = { kind: Kind; booking: BookingRow; co: CompanyRow; eventId: number | null }
  const units: Unit[] = []

  const sinceIso = new Date(nowMs - EVENT_MAX_AGE_MIN * 60_000).toISOString()
  let evData: EventRow[]
  try {
    evData = await fetchAll<EventRow>(() =>
      admin
        .from('booking_events')
        .select(`id, booking_id, company_id, event_type, detail, created_at,
                 booking:bookings!inner (${BOOKING_COLUMNS})`)
        .in('event_type', Object.keys(EVENT_KIND))
        .gte('created_at', sinceIso)
        .order('id', { ascending: true }),
    )
  } catch (err) {
    return json({ error: 'query_failed', detail: err instanceof Error ? err.message : String(err) }, 500)
  }

  for (const ev of evData) {
    const co = companies.get(ev.company_id)
    const b = ev.booking
    if (!co || !b || !productOk.has(ev.company_id)) continue
    const kind = EVENT_KIND[ev.event_type]
    if (!kind) continue

    // Bekræftelser og ændringsvarsler beskriver bookingen som den ER, ikke som
    // den var: en booking der blev oprettet 10.01 og annulleret 10.03 skal ikke
    // først bekræftes og så afmeldes i samme kørsel. Annulleringen bærer sit
    // eget varsel; her springes de forældede hændelser over.
    if ((kind === 'created' || kind === 'updated') && b.status !== 'booked') continue

    const on =
      kind === 'created'
        ? eff(co, 'booking_created_enabled', true)
        : kind === 'updated'
          ? eff(co, 'booking_updated_enabled', true)
          : kind === 'cancelled'
            ? eff(co, 'booking_cancelled_enabled', true)
            : eff(co, 'booking_invoiced_enabled', false)
    if (!on) continue

    // Efterregistrering: bookingen var allerede afholdt da den blev oprettet.
    if (kind === 'created' && Date.parse(b.ends_at) <= Date.parse(ev.created_at)) continue
    if (kind === 'updated' && !movesSomething(ev.detail ?? {})) continue

    units.push({ kind, booking: b, co, eventId: ev.id })
  }

  // Påmindelser: bookinger der begynder inden for kundens vindue. Der hentes
  // med det STØRST tilladte vindue og filtreres pr. kunde bagefter — ét opslag
  // frem for ét pr. kunde.
  const remindersWanted = [...companies.values()].some(
    (co) => productOk.has(co.id) && eff(co, 'booking_reminder_enabled', false),
  )
  if (remindersWanted) {
    let bkData: BookingRow[]
    try {
      bkData = await fetchAll<BookingRow>(() =>
        admin
          .from('bookings')
          .select(BOOKING_COLUMNS)
          .eq('status', 'booked')
          .is('invoiced_at', null)
          .gt('starts_at', new Date(nowMs).toISOString())
          .lte('starts_at', new Date(nowMs + MAX_REMINDER_HOURS * HOUR).toISOString())
          .order('starts_at', { ascending: true })
          .order('id', { ascending: true }),
      )
    } catch (err) {
      return json({ error: 'query_failed', detail: err instanceof Error ? err.message : String(err) }, 500)
    }

    for (const b of bkData) {
      const co = companies.get(b.company_id)
      if (!co || !productOk.has(b.company_id)) continue
      if (!eff(co, 'booking_reminder_enabled', false)) continue
      const hours = eff<number>(co, 'booking_reminder_hours', 24)
      const dueAt = Date.parse(b.starts_at) - hours * HOUR
      if (nowMs < dueAt) continue
      // Bookingen blev oprettet efter påmindelsestidspunktet — bekræftelsen var
      // påmindelsen.
      if (Date.parse(b.created_at) >= dueAt) continue
      units.push({ kind: 'reminder', booking: b, co, eventId: null })
    }
  }

  if (units.length === 0) return json({ ok: true, processed: 0, sent: 0, failed: 0 })

  // ------------------------------------------------------------------
  // Allerede sendt/fejlet? Ét opslag for alle berørte bookinger.
  // ------------------------------------------------------------------
  // Fejler opslaget i beskedloggen, afbrydes kørslen: en tom historik ville
  // betyde "aldrig sendt" og sende alt igen.
  const bookingIds = [...new Set(units.map((u) => u.booking.id))]
  type LogRow = { booking_id: string; event_id: number | null; kind: string; audience: string; channel: string; status: string }
  let logRows: LogRow[]
  try {
    logRows = await fetchAll<LogRow>(() =>
      admin
        .from('booking_notifications')
        .select('booking_id, event_id, kind, audience, channel, status, id')
        .in('booking_id', bookingIds)
        .order('id', { ascending: true }),
    )
  } catch (err) {
    return json({ error: 'query_failed', detail: err instanceof Error ? err.message : String(err) }, 500)
  }
  const [ptplRes, ctplRes] = await Promise.all([
    admin.from('platform_templates').select('key, lang, title, body').in('key', ALL_TEMPLATE_KEYS),
    admin
      .from('company_templates')
      .select('company_id, key, lang, title, body')
      .in('key', ALL_TEMPLATE_KEYS)
      .in('company_id', [...new Set(units.map((u) => u.co.id))]),
  ])

  // Nøglen svarer til de to unikke indeks: hændelsesbeskeder dedupes på
  // hændelsen, påmindelser på bookingen.
  const dedupKey = (
    bookingId: string,
    eventId: number | null,
    kind: Kind,
    audience: Audience,
    channel: Channel,
  ) => `${eventId ?? `b:${bookingId}:${kind}`}:${audience}:${channel}`

  const sentSet = new Set<string>()
  const failedCount = new Map<string, number>()
  for (const r of logRows) {
    const k = dedupKey(r.booking_id, r.event_id, r.kind as Kind, r.audience as Audience, r.channel as Channel)
    if (r.status === 'sent') sentSet.add(k)
    else if (r.status === 'failed') failedCount.set(k, (failedCount.get(k) ?? 0) + 1)
  }

  const ptpls = ptplRes.data ?? []
  const ctpls = ctplRes.data ?? []
  const tpl = (companyId: string, key: string, lang: string) =>
    resolveTemplate(ptpls, ctpls, companyId, key, lang)

  // ------------------------------------------------------------------
  // Rekvirenten: bookingens `booked_by`. Slås op som medarbejder (så alle
  // kanaler kan bruges) og falder tilbage på app-brugerens e-mail, når den der
  // bookede ikke selv står i medarbejderkartoteket — typisk en manager.
  // ------------------------------------------------------------------
  const bookerIds = [
    ...new Set(
      units
        .filter((u) => u.kind !== 'invoiced')
        .map((u) => u.booking.booked_by)
        .filter((v): v is string => !!v),
    ),
  ]
  const bookerEmp = new Map<string, EmployeeRow>()
  const bookerUser = new Map<string, { full_name: string; email: string | null }>()
  if (bookerIds.length > 0) {
    const [empRes, usrRes] = await Promise.all([
      admin
        .from('employees')
        .select('id, full_name, language, email, phone, external_id, slack_user_id, user_id')
        .in('user_id', bookerIds)
        .eq('is_active', true),
      admin.from('app_users').select('user_id, full_name, email').in('user_id', bookerIds),
    ])
    for (const e of (empRes.data ?? []) as unknown as EmployeeRow[]) {
      if (e.user_id) bookerEmp.set(e.user_id, e)
    }
    for (const u of usrRes.data ?? []) {
      bookerUser.set(u.user_id, { full_name: u.full_name, email: u.email })
    }
  }

  // Forbigående udbyderfejl: samme mønster som pakke-dispatcheren — ingen
  // 'failed'-række (den ville tælle mod MAX_ATTEMPTS), kanalen sættes i pause
  // for kunden i resten af kørslen, og der lægges højst én advarsel i timen.
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

  let processed = 0
  let sent = 0
  let failed = 0
  let skippedQuiet = 0

  for (const u of units) {
    const { booking: b, co, kind } = u
    const feats = featureMap.get(co.id) ?? new Set<string>()
    const channels = enabledChannels(co, platform, feats)
    if (channels.length === 0) continue

    // Stilletid gælder alle booking-beskeder. Bekræftelsen udskydes altså til
    // efter stilletiden — hændelsen ligger stadig i vinduet ved næste kørsel,
    // så længe udfaldet er kortere end EVENT_MAX_AGE_MIN.
    if (inQuietHours(nowMin, co.quiet_hours_start ?? platform.quiet_hours_start,
                     co.quiet_hours_end ?? platform.quiet_hours_end)) {
      skippedQuiet++
      continue
    }

    const coLang = co.default_language || 'da'
    const emp = b.employee
    const resourceName = b.resource?.name ?? ''

    // Modtagerlisten. Faktureringsbeskeden går KUN til økonomipostkassen —
    // modtageren er den der skal handle på grundlaget, ikke medarbejderen.
    type Target = { audience: Audience; rec: ChannelRecipient; name: string; lang: string; only?: Channel[] }
    const targets: Target[] = []

    if (kind === 'invoiced') {
      if (co.booking_invoice_email) {
        targets.push({
          audience: 'economy',
          rec: { email: co.booking_invoice_email },
          name: co.name ?? '',
          lang: coLang,
          only: ['email'],
        })
      }
    } else {
      if (emp) {
        targets.push({
          audience: 'employee',
          rec: emp,
          name: emp.full_name ?? '',
          lang: emp.language || coLang,
        })
      }
      if (eff(co, 'booking_notify_booker', true) && b.booked_by && b.booked_by !== emp?.user_id) {
        const be = bookerEmp.get(b.booked_by)
        const bu = bookerUser.get(b.booked_by)
        if (be) {
          targets.push({
            audience: 'booker',
            rec: be,
            name: be.full_name ?? '',
            lang: be.language || coLang,
          })
        } else if (bu?.email) {
          targets.push({
            audience: 'booker',
            rec: { email: bu.email },
            name: bu.full_name || '',
            lang: coLang,
          })
        }
      }
      if (co.booking_copy_email) {
        targets.push({
          audience: 'copy',
          rec: { email: co.booking_copy_email },
          name: co.name ?? '',
          lang: coLang,
          only: ['email'],
        })
      }
    }
    if (targets.length === 0) continue

    let touched = false

    for (const target of targets) {
      const lang = target.lang
      const tokens: Record<string, string> = {
        recipient_name: target.name,
        resource_name: resourceName,
        booking_time: bookingTimeLabel(b, lang),
        booking_title: b.title ?? '',
        employee_name: emp?.full_name ?? '',
        company_name: co.name ?? '',
      }

      for (const channel of channels) {
        if (target.only && !target.only.includes(channel)) continue

        const key = dedupKey(b.id, u.eventId, kind, target.audience, channel)
        if (sentSet.has(key)) continue
        if ((failedCount.get(key) ?? 0) >= MAX_ATTEMPTS) continue

        const to = recipientFor(channel, target.rec, co)
        if (!to) continue

        const { title, body } = tpl(co.id, templateKeyFor(channel, BASE_KEY[kind]), lang)
        if (!body) continue // ingen skabelon → send ikke en tom besked

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

        touched = true
        const { error: logErr } = await admin.from('booking_notifications').insert({
          company_id: co.id,
          booking_id: b.id,
          event_id: u.eventId,
          kind,
          audience: target.audience,
          channel,
          lang,
          recipient: to,
          status: result.ok ? 'sent' : 'failed',
          provider_id: result.id ?? null,
          error: result.ok ? null : sanitizeProviderError(result.error, 500),
        })
        if (logErr) {
          // Beskeden ER afsendt, men sporet mangler — næste kørsel ville sende
          // igen. Det kan vi ikke afværge her (rækken er dedup-ankeret), men
          // det må ikke ske i det skjulte: konsollen OG Logs får besked, og
          // resten af bookingen springes over i denne kørsel.
          console.error(`booking_notifications-insert fejlede for ${b.id}/${kind}/${target.audience}/${channel}:`, logErr.message)
          await admin.rpc('log_notification_event', {
            p_company_id: co.id,
            p_action: 'booking.notification_log_failed',
            p_entity_type: 'booking',
            p_entity_id: b.id,
            p_summary: resourceName || '—',
            p_detail: {
              channel,
              kind,
              audience: target.audience,
              recipient: maskRecipient(to, channel),
              delivered: result.ok,
              error: sanitizeProviderError(logErr.message, 300),
            },
          })
          // Ankeret holdes i hukommelsen for resten af kørslen, så samme
          // modtager i det mindste ikke rammes to gange NU.
          if (result.ok) sentSet.add(key)
          continue
        }

        if (result.ok) {
          sent++
          sentSet.add(key)
        } else {
          failed++
          failedCount.set(key, (failedCount.get(key) ?? 0) + 1)
          // Kun fejl havner i Logs — kvitteringer ville oversvømme
          // aktivitetsloggen med hver eneste automatiske udsendelse.
          await admin.rpc('log_notification_event', {
            p_company_id: co.id,
            p_action: 'booking.notification_failed',
            p_entity_type: 'booking',
            p_entity_id: b.id,
            p_summary: resourceName || '—',
            p_detail: {
              channel,
              kind,
              audience: target.audience,
              recipient: maskRecipient(to, channel),
              reason: classifySendError(result.error ?? '', channel),
              error: sanitizeProviderError(result.error, 300),
            },
          })
        }
      }
    }

    if (touched) processed++
  }

  // Én advarsel pr. kunde/kanal pr. time om forbigående udfald.
  const oneHourAgo = new Date(nowMs - HOUR).toISOString()
  for (const h of halted.values()) {
    const { data: recent } = await admin
      .from('audit_log')
      .select('id')
      .eq('company_id', h.companyId)
      .eq('action', 'booking.notifications_deferred')
      .eq('detail->>channel', h.channel)
      .gte('created_at', oneHourAgo)
      .limit(1)
    if (recent && recent.length > 0) continue
    await admin.rpc('log_notification_event', {
      p_company_id: h.companyId,
      p_action: 'booking.notifications_deferred',
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
    skippedQuiet,
    candidates: units.length,
  })
})

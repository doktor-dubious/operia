// Delt logik for pakke-statusbeskeden (det daglige sammendrag).
//
// Bruges to steder, som SKAL være enige om hvem der får hvad:
//   • dispatch-parcel-notifications — den planlagte udsendelse (pg_cron)
//   • send-test-status — managerens testknap (forhåndsvisning + enkelt-send)
// Ligger logikken ét sted, viser forhåndsvisningen præcis det der sendes.

import { DAY, fmtDate } from './notify.ts'

export const OPEN_STATUSES = ['registered', 'in_storage', 'in_transit', 'in_locker']
export const STATUS_EMAIL_KEY = 'package_status'
export const STATUS_SMS_KEY = 'package_status_sms'

// Testsendinger logges med dette præfiks i digest_key i stedet for datoen. De
// tæller derfor hverken som "dagens sammendrag" (dedup) eller som "sidste
// sammendrag" (vinduets start) — en test forstyrrer ikke den rigtige udsendelse.
export const TEST_DIGEST_PREFIX = 'test-'

// Statusbeskeden dækker to ting: pakker der VENTER og pakker der er UDLEVERET
// siden sidste sammendrag. De hentes med hver sin forespørgsel (åbne statusser
// vs. 'delivered'), men deles om samme select og samme enheds-opbygning.
export const DELIVERED_STATUS = 'delivered'

// Kandidat-pakker med modtager, virksomhed og batch. Samme form begge steder.
export const PARCEL_SELECT = `id, barcode, registered_at, delivered_at, delivered_to,
   company_id, batch_id,
   receiver:employees!parcels_receiver_employee_id_fkey!inner (id, full_name, email, phone, language, is_active),
   company:companies!inner (id, name, default_language, quiet_hours_start, quiet_hours_end,
     parcel_reminder_1_days, parcel_reminder_2_days, parcel_reminder_max,
     parcel_reminder_1_enabled, parcel_reminder_2_enabled, parcel_arrival_enabled,
     parcel_status_enabled, parcel_status_time,
     notify_email_enabled, notify_sms_enabled),
   batch:parcel_batches (id, status, batch_code)`

export type EmployeeRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  language: string | null
  is_active: boolean
}
export type CompanyRow = {
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
  parcel_arrival_enabled: boolean | null
  parcel_status_enabled: boolean | null
  parcel_status_time: string | null
  notify_email_enabled: boolean | null
  notify_sms_enabled: boolean | null
}
export type BatchRow = { id: string; status: string; batch_code: string | null }
export type ParcelRow = {
  id: string
  barcode: string | null
  registered_at: string
  delivered_at: string | null
  delivered_to: string | null
  company_id: string
  batch_id: string | null
  receiver: EmployeeRow | null
  company: CompanyRow | null
  batch: BatchRow | null
}

// En afsendelses-enhed: enten en enkelt pakke eller en hel (afsluttet) batch,
// repræsenteret ved sin tidligst-registrerede pakke. `key` er dedup-identiteten.
export type Unit = {
  key: string
  parcel: ParcelRow
  emp: EmployeeRow
  co: CompanyRow
  batchId: string | null
  batchCode: string | null
  count: number
}

/**
 * Byg afsendelses-enheder ud fra kandidat-pakkerne (sorteret registered_at asc).
 * Batches samles til én enhed med den tidligst-registrerede pakke som
 * repræsentant; pakker i en 'open' batch springes over — der notificeres først
 * når receptionisten har afsluttet batchen.
 *
 * includeOpenBatches bruges til de UDLEVEREDE pakker: en udlevering er sket og
 * skal rapporteres, også selv om batchen aldrig blev afsluttet formelt.
 */
export function buildUnits(
  parcels: ParcelRow[],
  batchCounts: Map<string, number>,
  { includeOpenBatches = false }: { includeOpenBatches?: boolean } = {},
): Unit[] {
  const units: Unit[] = []
  const seenBatch = new Set<string>()
  for (const p of parcels) {
    const emp = p.receiver
    const co = p.company
    if (!emp || !co || !emp.is_active) continue
    if (p.batch_id && p.batch) {
      if (!includeOpenBatches && p.batch.status !== 'finished') continue
      if (seenBatch.has(p.batch_id)) continue
      seenBatch.add(p.batch_id)
      units.push({
        key: p.batch_id,
        parcel: p,
        emp,
        co,
        batchId: p.batch_id,
        batchCode: p.batch.batch_code,
        count: batchCounts.get(p.batch_id) ?? 1,
      })
    } else {
      units.push({ key: p.id, parcel: p, emp, co, batchId: null, batchCode: null, count: 1 })
    }
  }
  return units
}

/**
 * Alt der hører til én modtagers sammendrag: de ventende enheder og de
 * udleverede pakker. De udleverede holdes som RÅ pakker (ikke enheder), fordi
 * de først må samles til batch-enheder EFTER at vinduet er kendt — vinduet er
 * pr. modtager, og en batch kan være delvist udleveret hen over to sammendrag.
 */
export type DigestGroup = {
  co: CompanyRow
  emp: EmployeeRow
  units: Unit[]
  delivered: ParcelRow[]
}

/** Statusbeskeden er pr. modtager — grupper på (virksomhed, modtager). */
export function groupUnitsByEmployee(units: Unit[], delivered: ParcelRow[] = []): DigestGroup[] {
  const groups = new Map<string, DigestGroup>()
  const groupFor = (companyId: string, emp: EmployeeRow, co: CompanyRow) => {
    const key = `${companyId}:${emp.id}`
    if (!groups.has(key)) groups.set(key, { co, emp, units: [], delivered: [] })
    return groups.get(key)!
  }
  for (const u of units) groupFor(u.parcel.company_id, u.emp, u.co).units.push(u)
  for (const p of delivered) {
    const emp = p.receiver
    const co = p.company
    if (!emp || !co || !emp.is_active) continue
    groupFor(p.company_id, emp, co).delivered.push(p)
  }
  return [...groups.values()]
}

export type DigestHistoryRow = {
  employee_id: string | null
  channel: string
  status: string
  digest_key: string | null
  created_at: string
}

/**
 * Statusbeskedens historik pr. modtager: hvornår gik det seneste sammendrag ud
 * (vinduets start) og er dagens allerede sendt/fejlet pr. kanal.
 * Testsendinger (TEST_DIGEST_PREFIX) tælles ikke med nogen af stederne.
 */
export function parseDigestHistory(rows: DigestHistoryRow[], today: string) {
  const lastDigestAt = new Map<string, number>()
  const digestSent = new Set<string>()
  const digestFailed = new Map<string, number>()
  for (const r of rows) {
    if (!r.employee_id) continue
    if (r.digest_key?.startsWith(TEST_DIGEST_PREFIX)) continue
    const key = `${r.employee_id}:${r.channel}`
    if (r.status === 'sent') {
      const ts = Date.parse(r.created_at)
      if (ts > (lastDigestAt.get(r.employee_id) ?? 0)) lastDigestAt.set(r.employee_id, ts)
      if (r.digest_key === today) digestSent.add(key)
    } else if (r.status === 'failed' && r.digest_key === today) {
      digestFailed.set(key, (digestFailed.get(key) ?? 0) + 1)
    }
  }
  return { lastDigestAt, digestSent, digestFailed }
}

/**
 * Vinduets start: alt siden modtagerens sidste sammendrag. Har modtageren
 * aldrig fået ét, bruges de sidste 24 timer — ellers ville første udsendelse
 * dumpe hele bagkataloget (samme hensyn som ARRIVAL_MAX_AGE_DAYS).
 */
export function digestWindowStart(
  lastDigestAt: Map<string, number>,
  employeeId: string,
  nowMs: number,
): number {
  return lastDigestAt.get(employeeId) ?? nowMs - DAY
}

/** Enhederne der hører til sammendraget: ankommet efter vinduets start. */
export function digestItems(units: Unit[], since: number): Unit[] {
  return units.filter((u) => Date.parse(u.parcel.registered_at) > since)
}

/**
 * De udleverede enheder i sammendraget: pakker udleveret efter vinduets start.
 * Batch-optællingen laves af netop de pakker der er udleveret i vinduet — en
 * batch-linje betyder altså "n pakker fra batchen er udleveret", ikke "hele
 * batchen". Derfor bygges enhederne her og ikke sammen med de ventende.
 */
export function deliveredItems(parcels: ParcelRow[], since: number): Unit[] {
  const inWindow = parcels.filter(
    (p) => p.delivered_at != null && Date.parse(p.delivered_at) > since,
  )
  const counts = new Map<string, number>()
  for (const p of inWindow) {
    if (p.batch_id) counts.set(p.batch_id, (counts.get(p.batch_id) ?? 0) + 1)
  }
  return buildUnits(inWindow, counts, { includeOpenBatches: true })
}

/** Samlet antal pakker i sammendraget (en batch tæller alle sine pakker). */
export function digestCount(items: Unit[]): number {
  return items.reduce((n, u) => n + u.count, 0)
}

// Overskrifterne på de to afsnit. De bor i koden — ikke i skabelonen — fordi et
// afsnit skal kunne udelades HELT når det er tomt; en skabelon uden betingelser
// ville ellers efterlade en overskrift uden indhold.
const SECTION_LABELS: Record<string, { waiting: string; delivered: string; to: string }> = {
  da: { waiting: 'Venter i varemodtagelsen:', delivered: 'Udleveret:', to: 'til' },
  en: { waiting: 'Waiting at goods reception:', delivered: 'Handed over:', to: 'to' },
}

function labels(lang: string) {
  return lang.startsWith('en') ? SECTION_LABELS.en : SECTION_LABELS.da
}

// Linjeformat: '• <kode> – <dato>'. En batch vises som kode + antal i parentes.
function unitLabel(u: Unit): string {
  return u.batchId ? `${u.batchCode || '—'} (${u.count})` : u.parcel.barcode || '—'
}

/**
 * Et afsnit: overskrift + én linje pr. enhed, med afsluttende linjeskift så to
 * afsnit kan stå lige efter hinanden i skabelonen. Tom streng når der intet er.
 */
function section(heading: string, lines: string[]): string {
  return lines.length ? `${heading}\n${lines.join('\n')}\n` : ''
}

/**
 * Skabelon-koderne til statusbeskeden.
 *   {{count}} / {{parcel_list}}            — pakker der venter (ankomstdato)
 *   {{delivered_count}} / {{delivered_list}} — pakker udleveret siden sidst
 * Listerne indeholder deres egen overskrift og er tomme når afsnittet er tomt.
 */
export function digestTokens(
  items: Unit[],
  delivered: Unit[],
  emp: EmployeeRow,
  co: CompanyRow,
  lang: string,
  nowMs: number,
): Record<string, string> {
  const l = labels(lang)
  return {
    recipient_name: emp.full_name ?? '',
    company_name: co.name ?? '',
    date: fmtDate(new Date(nowMs).toISOString(), lang),
    count: String(digestCount(items)),
    delivered_count: String(digestCount(delivered)),
    parcel_list: section(
      l.waiting,
      items.map((u) => `• ${unitLabel(u)} – ${fmtDate(u.parcel.registered_at, lang)}`),
    ),
    delivered_list: section(
      l.delivered,
      delivered.map((u) => {
        // Udleveret til en anden end modtageren selv (fuldmagt/afleveret et
        // sted) — netop dét er værd at fortælle modtageren.
        const to = (u.parcel.delivered_to ?? '').trim()
        const proxy = to && to !== (emp.full_name ?? '').trim() ? ` (${l.to} ${to})` : ''
        const when = u.parcel.delivered_at ?? u.parcel.registered_at
        return `• ${unitLabel(u)} – ${fmtDate(when, lang)}${proxy}`
      }),
    ),
  }
}

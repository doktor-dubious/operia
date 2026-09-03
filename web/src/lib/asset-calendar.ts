import { supabase } from '@/lib/supabase'
import { ASSET_LOOKUP_COLUMNS, type AssetHit } from '@/lib/asset-lookup'

// Datagrundlaget for aktivkalenderen: perioder hvor et aktiv er "ude" —
// udlån (asset_loans, inkl. afsluttede = historik), aktuel service og
// aktuelle tildelinger. Kun udlån har fuld historik i datamodellen; service
// og tildeling vises som den igangværende periode (starten hentes fra
// hændelsesloggen hhv. assigned_at).
//
// Åbne perioder uden slutdato (tildelinger, udlån uden udløb) er per design
// endeløse — kalenderen tegner dem med takket højrekant. Et forfaldent udlån
// løber visuelt til i dag: aktivet ER stadig ude.

// Visningstyper og dato-hjælpere er fælles for produkternes kalendere og bor i
// lib/calendar.ts; her genudleveres de, så eksisterende imports består.
export {
  CALENDAR_VIEWS,
  isCalendarView,
  toISODate,
  isISODate,
  parseISODate,
  startOfDay,
  endOfDay,
  addDays,
  diffDays,
  viewRange,
  stepAnchor,
} from '@/lib/calendar'
export type { CalendarView } from '@/lib/calendar'
import { endOfDay, parseISODate, startOfDay, diffDays } from '@/lib/calendar'

export type CalendarKind = 'loan' | 'service' | 'assigned'

export type CalendarEntry = {
  key: string
  kind: CalendarKind
  asset: AssetHit
  start: Date
  /** Faktisk eller planlagt slut; null = uden slutdato. */
  end: Date | null
  /** Udlån der er leveret tilbage (historik) — kan aldrig være forfaldent. */
  closed: boolean
  /** Frist der kan forfalde: udlånets udløb eller forventet retur fra service. */
  due: Date | null
  /** Hvem/hvor aktivet er: låner, værksted eller medarbejder. */
  holder: string | null
}

// --- Periode-logik ----------------------------------------------------------

/**
 * Den kant perioden tegnes/regnes til: faktisk slut for afsluttede udlån,
 * fristen for åbne perioder — dog mindst i dag, for et forfaldent aktiv er
 * stadig ude. null = endeløs (tildeling, udlån uden udløb).
 */
export function effectiveEnd(e: CalendarEntry, today: Date): Date | null {
  if (e.closed) return e.end
  if (!e.due) return null
  return e.due < today ? today : e.due
}

export function entryOverlaps(e: CalendarEntry, from: Date, to: Date, today: Date): boolean {
  if (e.start > endOfDay(to)) return false
  const end = effectiveEnd(e, today)
  return end === null || end >= startOfDay(from)
}

export function isOverdue(e: CalendarEntry, today: Date): boolean {
  return !e.closed && !!e.due && e.due < startOfDay(today)
}

export function isDueSoon(e: CalendarEntry, today: Date, withinDays: number): boolean {
  if (e.closed || !e.due) return false
  const d = diffDays(today, e.due)
  return d >= 0 && d <= withinDays
}

/** 0 = forfaldet, 1 = forfalder snart, 2 = åben, 3 = afsluttet. */
export function urgencyRank(e: CalendarEntry, today: Date, withinDays: number): number {
  if (isOverdue(e, today)) return 0
  if (isDueSoon(e, today, withinDays)) return 1
  return e.closed ? 3 : 2
}

/** Sorter mest presserende først; ens rang afgøres af frist, så navn. */
export function compareUrgency(
  a: CalendarEntry,
  b: CalendarEntry,
  today: Date,
  withinDays: number,
): number {
  const ra = urgencyRank(a, today, withinDays)
  const rb = urgencyRank(b, today, withinDays)
  if (ra !== rb) return ra - rb
  const da = a.due?.getTime() ?? Infinity
  const db = b.due?.getTime() ?? Infinity
  if (da !== db) return da - db
  return a.asset.name.localeCompare(b.asset.name, 'da')
}

// --- Hentning ---------------------------------------------------------------

export const CALENDAR_MAX_ROWS = 2000

// Portionsstørrelse for asset_id-filtret på servicehændelserne: 100 uuid'er
// fylder ~3,7 kB i URL'en, godt under enhver fornuftig grænse.
const SERVICE_ID_CHUNK = 100

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

type LoanRow = {
  id: string
  asset_id: string
  to_name: string
  lent_at: string
  expires_at: string | null
  returned_at: string | null
  asset: AssetHit | null
}

/**
 * Alle kalenderposter der overlapper [rangeStart; rangeEnd]:
 *  - udlån (åbne + afsluttede) via overlap-filter i databasen
 *  - aktiver aktuelt i service/tildelt (tilstande, ikke intervaller — hentes
 *    hele og afgrænses klient-side)
 * Servicestarten hentes fra seneste service_sent-hændelse pr. aktiv; mangler
 * den (ældre data), bruges aktivets oprettelse som nedre grænse.
 */
export async function fetchCalendarEntries(
  companyId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{ entries: CalendarEntry[]; capped: boolean }> {
  const [loansRes, assetsRes] = await Promise.all([
    supabase
      .from('asset_loans')
      .select(
        `id, asset_id, to_name, lent_at, expires_at, returned_at, asset:assets!asset_loans_asset_id_fkey (${ASSET_LOOKUP_COLUMNS})`,
      )
      .eq('company_id', companyId)
      .lte('lent_at', endOfDay(rangeEnd).toISOString())
      // Åbne udlån løber til i dag/fristen og overlapper altid fremad;
      // afsluttede kræver returnering efter periodens start.
      .or(`returned_at.is.null,returned_at.gte.${startOfDay(rangeStart).toISOString()}`)
      .order('lent_at', { ascending: false })
      .limit(CALENDAR_MAX_ROWS),
    supabase
      .from('assets')
      .select(ASSET_LOOKUP_COLUMNS)
      .eq('company_id', companyId)
      .in('status', ['service', 'assigned'])
      .order('name')
      .limit(CALENDAR_MAX_ROWS),
  ])
  if (loansRes.error) throw loansRes.error
  if (assetsRes.error) throw assetsRes.error

  const loans = (loansRes.data ?? []) as unknown as LoanRow[]
  const stateAssets = (assetsRes.data ?? []) as unknown as AssetHit[]

  // Servicestarten hentes KUN for de aktiver der faktisk står i service.
  // Uden asset_id-filtret hentede vi de nyeste CALENDAR_MAX_ROWS service_sent i
  // hele virksomheden — i en kunde med lang servicehistorik faldt et aktivs
  // egen hændelse uden for det vindue, og bjælken blev så tegnet fra aktivets
  // oprettelse (potentielt år tilbage). Id-listen deles i portioner, så URL'en
  // ikke vokser ud over hvad PostgREST tager imod.
  const serviceStart = new Map<string, Date>()
  const serviceIds = stateAssets.filter((a) => a.status === 'service').map((a) => a.id)
  const serviceEventChunks = await Promise.all(
    chunk(serviceIds, SERVICE_ID_CHUNK).map((ids) =>
      supabase
        .from('asset_events')
        .select('asset_id, created_at')
        .eq('company_id', companyId)
        .eq('event_type', 'service_sent')
        .in('asset_id', ids)
        .order('created_at', { ascending: false })
        .limit(CALENDAR_MAX_ROWS),
    ),
  )
  let serviceEventCount = 0
  for (const res of serviceEventChunks) {
    if (res.error) throw res.error
    serviceEventCount += (res.data ?? []).length
    // Nyeste-først, så den første række pr. aktiv er den seneste udsendelse.
    for (const ev of res.data ?? []) {
      if (!serviceStart.has(ev.asset_id)) serviceStart.set(ev.asset_id, new Date(ev.created_at))
    }
  }

  const entries: CalendarEntry[] = []
  for (const loan of loans) {
    if (!loan.asset) continue
    entries.push({
      key: `loan:${loan.id}`,
      kind: 'loan',
      asset: loan.asset,
      start: new Date(loan.lent_at),
      end: loan.returned_at
        ? new Date(loan.returned_at)
        : loan.expires_at
          ? new Date(loan.expires_at)
          : null,
      closed: !!loan.returned_at,
      due: loan.returned_at ? null : loan.expires_at ? new Date(loan.expires_at) : null,
      holder: loan.to_name,
    })
  }
  for (const asset of stateAssets) {
    if (asset.status === 'service') {
      const due = asset.service_expected_back
        ? parseISODate(asset.service_expected_back)
        : null
      entries.push({
        key: `service:${asset.id}`,
        kind: 'service',
        asset,
        start: serviceStart.get(asset.id) ?? new Date(asset.created_at),
        end: due,
        closed: false,
        due,
        holder: asset.service_vendor,
      })
    } else {
      entries.push({
        key: `assigned:${asset.id}`,
        kind: 'assigned',
        asset,
        start: asset.assigned_at ? new Date(asset.assigned_at) : new Date(asset.created_at),
        end: null,
        closed: false,
        due: null,
        holder: asset.assigned?.full_name ?? null,
      })
    }
  }

  return {
    entries,
    capped:
      loans.length >= CALENDAR_MAX_ROWS ||
      stateAssets.length >= CALENDAR_MAX_ROWS ||
      serviceEventCount >= CALENDAR_MAX_ROWS,
  }
}

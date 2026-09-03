import type { QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { dayFormat, endOfDay, startOfDay, timeFormat } from '@/lib/calendar'
import type { Database } from '@/lib/database.types'

// Booking-domænet: typer, opslagskolonner, RPC-fejlkort og hentning til
// kalenderen. Al skrivning går gennem RPC'erne create_booking /
// update_booking / cancel_booking — bookings-tabellen har ingen skrivepolitik.

export type BookingStatus = Database['public']['Enums']['booking_status']
export type BookingTimeMode = 'timed' | 'day'

export type BookingResourceRow = Database['public']['Tables']['booking_resources']['Row']
export type BookingCategoryRow = Database['public']['Tables']['booking_categories']['Row']

/** Ressourcens effektive granularitet: egen indstilling, ellers virksomhedens. */
export function effectiveTimeMode(
  resource: Pick<BookingResourceRow, 'time_mode'> | null | undefined,
  companyMode: BookingTimeMode,
): BookingTimeMode {
  return resource?.time_mode === 'timed' || resource?.time_mode === 'day'
    ? resource.time_mode
    : companyMode
}

export const BOOKING_COLUMNS =
  'id, company_id, resource_id, employee_id, booked_by, starts_at, ends_at, all_day, title, status, cancelled_at, created_at'

export const BOOKING_EMBED = `${BOOKING_COLUMNS},
  resource:booking_resources (id, name, location, time_mode, is_active, category_id),
  employee:employees (id, full_name, initials)`

export type BookingHit = {
  id: string
  company_id: string
  resource_id: string
  employee_id: string | null
  booked_by: string | null
  starts_at: string
  ends_at: string
  all_day: boolean
  title: string | null
  status: BookingStatus
  cancelled_at: string | null
  created_at: string
  resource: {
    id: string
    name: string
    location: string | null
    time_mode: string | null
    is_active: boolean
    category_id: string | null
  } | null
  employee: {
    id: string
    full_name: string | null
    initials: string | null
  } | null
}

/**
 * Ligger intervallet i fortiden? Klient-spejl af assert_booking_not_retro:
 * heldags = skal række ind i nutiden; med klokkeslæt = starten må ikke være
 * passeret (5 min kulance, som serveren).
 */
export function isRetroInterval(starts: Date, ends: Date, allDay: boolean): boolean {
  const now = Date.now()
  return allDay ? ends.getTime() <= now : starts.getTime() < now - 5 * 60_000
}

/**
 * Bookingens tidsrum som læsbar tekst — ét sted, brugt af listen, kalenderen og
 * detaljepopup'en.
 *
 * Begge ender skal med når bookingen krydser et døgn: en bil kan bookes fredag
 * 14 → mandag 9, og "fre. 14.00 – 09.00" ville læses som et interval der
 * slutter før det begynder. For heldagsbookinger er ends_at det halvåbne
 * intervals næste midnat, så den viste slutdato er ends_at minus et øjeblik.
 */
export function bookingTimeLabel(b: {
  starts_at: string
  ends_at: string
  all_day: boolean
}): string {
  const from = new Date(b.starts_at)
  if (b.all_day) {
    const to = new Date(new Date(b.ends_at).getTime() - 1)
    const fromDay = dayFormat.format(from)
    const toDay = dayFormat.format(to)
    return fromDay === toDay ? fromDay : `${fromDay} – ${toDay}`
  }
  const to = new Date(b.ends_at)
  return dayFormat.format(from) === dayFormat.format(to)
    ? `${dayFormat.format(from)} ${timeFormat.format(from)}–${timeFormat.format(to)}`
    : `${dayFormat.format(from)} ${timeFormat.format(from)} – ${dayFormat.format(to)} ${timeFormat.format(to)}`
}

// RPC-fejlkoder → i18n-nøgler (samme idiom som ASSET_RPC_ERRORS).
export const BOOKING_RPC_ERRORS: Record<string, string> = {
  booking_overlap: 'bookingFlow.errOverlap',
  booking_in_past: 'bookingFlow.errInPast',
  booking_not_found: 'bookingFlow.errNotFound',
  booking_resource_not_found: 'bookingFlow.errResourceNotFound',
  booking_resource_inactive: 'bookingFlow.errResourceInactive',
  booking_invalid_interval: 'bookingFlow.errInvalidInterval',
  booking_not_editable: 'bookingFlow.errNotEditable',
  booking_already_cancelled: 'bookingFlow.errAlreadyCancelled',
  employee_not_found: 'bookingFlow.errEmployeeNotFound',
  employee_inactive: 'bookingFlow.errEmployeeInactive',
  not_authorized: 'common.noPermission',
}

export function bookingRpcErrorKey(error: { message?: string } | null): string | null {
  const msg = error?.message ?? ''
  for (const [code, key] of Object.entries(BOOKING_RPC_ERRORS)) {
    if (msg.includes(code)) return key
  }
  return null
}

/** Alle booking-nøgler starter med 'booking', så én prædikat-invalidering rækker. */
export function invalidateBookingQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('booking'),
  })
}

/**
 * Kategorifarver (--booking-category-N i index.css). Bjælkerne i kalenderen
 * farves efter ressourcens kategori, så en tidslinje med blandede ressourcer
 * kan læses uden at slå hver ressource op.
 */
export const BOOKING_CATEGORY_COLOR_COUNT = 13

/**
 * Kategori-id → paletindeks. Farven er managerens valg (color_index); kun hvis
 * kolonnen mod forventning er tom, falder vi tilbage til rækkefølgen, som var
 * den oprindelige regel før farvevælgeren.
 */
export function bookingCategoryColorMap(
  categories: { id: string; color_index: number | null }[],
): Map<string, number> {
  return new Map(
    categories.map((c, i) => [
      c.id,
      (c.color_index ?? i) % BOOKING_CATEGORY_COLOR_COUNT,
    ]),
  )
}

/** Baggrund + tekstfarve for et paletindeks; null = ressource uden kategori. */
export function bookingCategoryColors(index: number | null | undefined): {
  background: string
  color: string
} {
  const slot = index == null ? 'none' : String((index % BOOKING_CATEGORY_COLOR_COUNT) + 1)
  return {
    background: `var(--booking-category-${slot})`,
    color: `var(--booking-category-${slot}-fg)`,
  }
}

export const CALENDAR_MAX_ROWS = 2000

/**
 * Bookinger der overlapper [rangeStart; rangeEnd] (hele dage) — én
 * overlap-forespørgsel, fordi bookinger i modsætning til aktivtilstande ER
 * rigtige intervaller. Annullerede medtages ikke i kalenderen.
 */
export async function fetchBookingsInRange(
  companyId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<{ bookings: BookingHit[]; capped: boolean }> {
  const { data, error } = await supabase
    .from('bookings')
    .select(BOOKING_EMBED)
    .eq('company_id', companyId)
    .eq('status', 'booked')
    .lte('starts_at', endOfDay(rangeEnd).toISOString())
    .gte('ends_at', startOfDay(rangeStart).toISOString())
    .order('starts_at')
    .limit(CALENDAR_MAX_ROWS)
  if (error) throw error
  const bookings = (data ?? []) as unknown as BookingHit[]
  return { bookings, capped: bookings.length >= CALENDAR_MAX_ROWS }
}

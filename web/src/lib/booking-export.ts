import type { TFunction } from 'i18next'
import { dateStamp } from '@/lib/csv-export'
import { lineTotal, type BookingServiceLine } from '@/lib/booking-services'
import { bookingLifecycle, BOOKING_LIFECYCLE_KEYS, type BookingHit } from '@/lib/booking'

// Eksport af bookinger og afregningsdata som CSV (EVU-krav B-01).
//
// TO RÆKKEFORMER, fordi kravet er to ting ("bookinger OG afregningsdata"):
//   'bookings' — én række pr. booking, med ydelsernes samlede beløb i en
//                kolonne. Overblikket.
//   'lines'    — én række pr. tilkøbsydelse (booking, ydelse, antal,
//                enhedspris, beløb). En booking med tre ydelser fylder tre
//                rækker. Det er DEN form, et regnskabs- eller FM-system kan
//                bruge; et beløb pr. booking kan ikke rumme N linjer.
//
// TIDSSTEMPLER eksporteres altid som de er GEMT — også for heldagsbookinger,
// hvor ends_at er det halvåbne intervals næste midnat. Kolonnen `all_day`
// følger med, så modtageren kan se hvorfor. Alternativet (at trække et
// øjeblik fra i den danske visning, men ikke i ISO) ville gøre de to formater
// uenige om det samme tal.
//
// DALUX-PROFILEN er med vilje TOM. Dalux' import henter sin kolonneskabelon
// fra Dalux selv — man eksporterer et eksisterende objekt for at få arket, og
// kun visse felter kan importeres igen. Hvilke kolonner en booking skal blive
// til afhænger derfor af, hvilket Dalux-objekt kunden mener (krav B-04/B-08,
// stadig ubesvaret). Profilen står som et synligt, deaktiveret valg frem for
// slet ikke at findes: så er det tydeligt, at pladsen er holdt, og at det der
// mangler er en skabelon fra kunden — ikke ny funktionalitet.

export type ExportShape = 'bookings' | 'lines'
export type ExportProfile = 'operia' | 'excel_da' | 'dalux'

export type ExportOptions = {
  shape: ExportShape
  profile: ExportProfile
  separator: string
  decimal: '.' | ','
  dateFormat: 'iso' | 'da'
  header: boolean
  columns: string[]
}

/** Hvilket udsnit blev eksporteret? Går med i revisionssporet. */
export type ExportScope = 'booking' | 'resource' | 'timeframe' | 'filtered' | 'selected'

type ColumnDef = { key: string; labelKey: string }

// Kolonnerne i vist rækkefølge. Nøglerne er maskinlæsbare og bruges både som
// standard-overskrift (Operia-profilen) og som feltnøgle internt.
export const BOOKING_EXPORT_COLUMNS: ColumnDef[] = [
  { key: 'booking_id', labelKey: 'bookingExport.colBookingId' },
  { key: 'status', labelKey: 'bookingExport.colStatus' },
  { key: 'resource', labelKey: 'bookingExport.colResource' },
  { key: 'resource_location', labelKey: 'bookingExport.colResourceLocation' },
  { key: 'employee', labelKey: 'bookingExport.colEmployee' },
  { key: 'employee_initials', labelKey: 'bookingExport.colEmployeeInitials' },
  { key: 'purpose', labelKey: 'bookingExport.colPurpose' },
  { key: 'starts_at', labelKey: 'bookingExport.colStartsAt' },
  { key: 'ends_at', labelKey: 'bookingExport.colEndsAt' },
  { key: 'all_day', labelKey: 'bookingExport.colAllDay' },
  { key: 'days', labelKey: 'bookingExport.colDays' },
  { key: 'participants', labelKey: 'bookingExport.colParticipants' },
  { key: 'participant_level', labelKey: 'bookingExport.colParticipantLevel' },
  { key: 'services_count', labelKey: 'bookingExport.colServicesCount' },
  { key: 'services_total', labelKey: 'bookingExport.colServicesTotal' },
  { key: 'currency', labelKey: 'bookingExport.colCurrency' },
  { key: 'invoiced_at', labelKey: 'bookingExport.colInvoicedAt' },
  { key: 'cancelled_at', labelKey: 'bookingExport.colCancelledAt' },
  { key: 'cancellation_reason', labelKey: 'bookingExport.colCancellationReason' },
  { key: 'created_at', labelKey: 'bookingExport.colCreatedAt' },
]

export const LINE_EXPORT_COLUMNS: ColumnDef[] = [
  { key: 'booking_id', labelKey: 'bookingExport.colBookingId' },
  { key: 'resource', labelKey: 'bookingExport.colResource' },
  { key: 'employee', labelKey: 'bookingExport.colEmployee' },
  { key: 'starts_at', labelKey: 'bookingExport.colStartsAt' },
  { key: 'ends_at', labelKey: 'bookingExport.colEndsAt' },
  { key: 'service', labelKey: 'bookingExport.colService' },
  { key: 'quantity', labelKey: 'bookingExport.colQuantity' },
  { key: 'unit_price', labelKey: 'bookingExport.colUnitPrice' },
  { key: 'price_mode', labelKey: 'bookingExport.colPriceMode' },
  { key: 'line_total', labelKey: 'bookingExport.colLineTotal' },
  { key: 'currency', labelKey: 'bookingExport.colCurrency' },
]

export function columnsFor(shape: ExportShape): ColumnDef[] {
  return shape === 'lines' ? LINE_EXPORT_COLUMNS : BOOKING_EXPORT_COLUMNS
}

/**
 * Profilernes standarder. 'operia' er maskinvenlig (ISO-datoer, punktum som
 * decimaltegn, komma som separator) og round-tripper ind i vores egen import.
 * 'excel_da' er det, dansk Excel faktisk forventer: semikolon og komma-decimal
 * — uden det åbner filen i én kolonne med amerikanske tal.
 */
export const PROFILE_DEFAULTS: Record<
  ExportProfile,
  Pick<ExportOptions, 'separator' | 'decimal' | 'dateFormat'>
> = {
  operia: { separator: ',', decimal: '.', dateFormat: 'iso' },
  excel_da: { separator: ';', decimal: ',', dateFormat: 'da' },
  // Pladsholder indtil kunden leverer en Dalux-skabelon (B-04).
  dalux: { separator: ';', decimal: ',', dateFormat: 'iso' },
}

export const AVAILABLE_PROFILES: ExportProfile[] = ['operia', 'excel_da']

const TZ = 'Europe/Copenhagen'

function fmtDateTime(iso: string | null | undefined, format: 'iso' | 'da'): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  if (format === 'iso') return d.toISOString()
  const parts = new Intl.DateTimeFormat('da-DK', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`
}

/**
 * Beløb uden tusindtalsseparator — det er data, ikke en visning. Decimaltegnet
 * følger profilen, fordi det er dét, der afgør om modtagersystemet læser
 * 3510.00 som tre tusind eller som tre.
 */
function fmtAmount(value: number, decimal: '.' | ','): string {
  const s = value.toFixed(2)
  return decimal === ',' ? s.replace('.', ',') : s
}

/** Antal påbegyndte døgn — grundlaget for "lokale × antal dage × pris" (C-01). */
export function bookingDays(b: { starts_at: string; ends_at: string }): number {
  const ms = Date.parse(b.ends_at) - Date.parse(b.starts_at)
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.max(1, Math.ceil(ms / 86_400_000))
}

export type ExportRow = Record<string, string | number | null | undefined>

export function buildBookingRows(
  bookings: BookingHit[],
  linesByBooking: Map<string, BookingServiceLine[]>,
  opts: ExportOptions,
  currency: string,
  t: TFunction,
): ExportRow[] {
  return bookings.map((b) => {
    const lines = linesByBooking.get(b.id) ?? []
    const total = lines.reduce((sum, l) => sum + lineTotal(l), 0)
    return {
      booking_id: b.id,
      status: t(BOOKING_LIFECYCLE_KEYS[bookingLifecycle(b)]),
      resource: b.resource?.name ?? '',
      resource_location: b.resource?.location ?? '',
      employee: b.employee?.full_name ?? '',
      employee_initials: b.employee?.initials ?? '',
      purpose: b.title ?? '',
      starts_at: fmtDateTime(b.starts_at, opts.dateFormat),
      ends_at: fmtDateTime(b.ends_at, opts.dateFormat),
      all_day: b.all_day ? '1' : '0',
      days: bookingDays(b),
      participants: b.participant_count ?? '',
      participant_level: b.level?.name ?? '',
      services_count: lines.length,
      services_total: fmtAmount(total, opts.decimal),
      currency,
      invoiced_at: fmtDateTime(b.invoiced_at, opts.dateFormat),
      cancelled_at: fmtDateTime(b.cancelled_at, opts.dateFormat),
      cancellation_reason: b.cancellation_reason ?? '',
      created_at: fmtDateTime(b.created_at, opts.dateFormat),
    }
  })
}

export function buildLineRows(
  bookings: BookingHit[],
  linesByBooking: Map<string, BookingServiceLine[]>,
  opts: ExportOptions,
  currency: string,
  t: TFunction,
): ExportRow[] {
  const rows: ExportRow[] = []
  for (const b of bookings) {
    for (const l of linesByBooking.get(b.id) ?? []) {
      rows.push({
        booking_id: b.id,
        resource: b.resource?.name ?? '',
        employee: b.employee?.full_name ?? '',
        starts_at: fmtDateTime(b.starts_at, opts.dateFormat),
        ends_at: fmtDateTime(b.ends_at, opts.dateFormat),
        service: l.service?.name ?? '',
        quantity: l.quantity,
        unit_price: fmtAmount(Number(l.unit_price ?? 0), opts.decimal),
        price_mode:
          l.price_mode === 'total'
            ? t('bookingServicesPage.priceModeTotal')
            : t('bookingServicesPage.priceModeUnit'),
        line_total: fmtAmount(lineTotal(l), opts.decimal),
        currency,
      })
    }
  }
  return rows
}

export function defaultFileName(shape: ExportShape, scope: ExportScope): string {
  const what = shape === 'lines' ? 'afregningslinjer' : 'bookinger'
  return `operia-${what}-${scope}-${dateStamp()}.csv`
}

/**
 * Filnavnet skal kunne bruges som filnavn: ingen stier og ingen af de tegn,
 * Windows afviser. Bindestreger og mellemrum bevares — standardnavnet er
 * bygget af bindestreger, og "kursus uge 38" skal ikke ende som "kursusuge38".
 */
const ILLEGAL_FILENAME = /[\\/:*?"<>|]/g

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(ILLEGAL_FILENAME, '')
    // Kontroltegn kan ikke tastes, men kan indsættes — de ryger ud for sig,
    // så regexet ovenfor kan holdes læsbart.
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .trim()
    .slice(0, 120)
  const base = cleaned || 'operia-eksport'
  return base.toLowerCase().endsWith('.csv') ? base : `${base}.csv`
}

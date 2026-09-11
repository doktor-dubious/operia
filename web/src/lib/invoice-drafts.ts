import type { TFunction } from 'i18next'

// Fakturakladden (EVU-krav C-01) — typerne og den lille smule regning, listen,
// detaljen og en senere rapport skal være enige om.
//
// Kladden er Operias egen og kender ikke noget regnskabssystem: `external_system`
// er 'manual', indtil en adapter sætter sit eget navn (C-02). Alt her er derfor
// systemuafhængigt med vilje.

export const DRAFT_STATUSES = ['draft', 'approved', 'transferred', 'cancelled'] as const
export type DraftStatus = (typeof DRAFT_STATUSES)[number]

export type DraftRow = {
  id: string
  number: string
  status: DraftStatus
  period_from: string | null
  period_to: string | null
  currency: string
  bill_to_name: string | null
  note: string | null
  external_system: string | null
  external_id: string | null
  invoice_no: string | null
  transferred_at: string | null
  approved_at: string | null
  /** 'invoice' eller 'credit' (kreditnota, C-09). */
  kind: 'invoice' | 'credit'
  credits_draft_id: string | null
  credited_by_draft_id: string | null
  /** Sat, når en booking på kladden er rettet efter dannelsen — se migration 20260912180000. */
  stale_at: string | null
  stale_reason: 'booking_updated' | 'booking_cancelled' | 'services_changed' | null
  created_at: string
  lines: { amount: number }[]
}

export type DraftLine = {
  id: string
  booking_id: string | null
  source: 'resource' | 'participants' | 'service' | 'manual'
  description: string
  quantity: number
  unit: string | null
  unit_price: number
  vat_code: string | null
  amount: number
  sort_order: number
}

export const DRAFT_SELECT = `id, number, status, period_from, period_to, currency,
  bill_to_name, note, external_system, external_id, invoice_no, transferred_at, approved_at, stale_at, stale_reason, kind, credits_draft_id, credited_by_draft_id,
  created_at, lines:invoice_draft_lines (amount)`

export const DRAFT_LINE_SELECT = `id, booking_id, source, description, quantity, unit,
  unit_price, vat_code, amount, sort_order`

export const draftTotal = (d: DraftRow): number =>
  (d.lines ?? []).reduce((sum, l) => sum + Number(l.amount ?? 0), 0)

export const linesTotal = (lines: DraftLine[]): number =>
  lines.reduce((sum, l) => sum + Number(l.amount ?? 0), 0)

/** Kan kladden stadig ændres? Overført og annulleret er endestationer. */
export const isDraftOpen = (s: DraftStatus): boolean => s === 'draft' || s === 'approved'

/**
 * Resultatet af en generering.
 *
 * `skipped` er den vigtige halvdel: kravet siger, at ingen afsluttet booking må
 * kunne overses (C-04), så de bookinger, der IKKE kom med, skal frem på skærmen
 * med deres årsag — ikke forsvinde i et "5 af 8 blev medtaget".
 */
export type GenerateResult = {
  draft_id: string | null
  number: string | null
  lines: number
  included: string[]
  skipped: { booking_id: string; reason: string }[]
}

export const skipReasonKey = (reason: string): string => `invoiceDrafts.skip.${reason}`

export function draftSearchText(d: DraftRow, t: TFunction): string {
  return [d.number, d.invoice_no, d.bill_to_name, d.note, t(`invoiceDrafts.status.${d.status}`)]
    .filter(Boolean)
    .join(' ')
}

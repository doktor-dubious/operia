import type { ParcelStatus } from '@/components/parcel-status-badge'

// Fælles definitioner for pakkeoversigten (/parcels/board): hvilke statusser der
// er "aktive" (cirklen) hhv. afsluttede (de to kasser), og tidsvinduerne for de
// afsluttede. Ligger her, så overbliks- og listekomponenten ikke kan komme i
// utakt med hinanden — og så en Link til en kategori kan valideres ét sted.

export const OPEN_STATUSES = [
  'unassigned',
  'registered',
  'in_storage',
  'in_transit',
  'in_locker',
] as const satisfies readonly ParcelStatus[]

// Bemærk: 'rejected' står bevidst IKKE her. En afvisning sender pakken direkte
// retur til afsenderen ('returned', jf. parcels.handout.tsx), så den mellem-
// liggende tilstand opstår ikke længere i drift. Ældre 'rejected'-pakker findes
// stadig i basen og nås via pakkelisten (/parcels/overview) og Søg.
export const TERMINAL_STATUSES = ['delivered', 'returned'] as const satisfies readonly ParcelStatus[]

// Fjernede (annullerede) fejlregistreringer står for sig selv: de er ikke et
// udfald af pakkeflowet, men en tilbagetrukket registrering. Kassen på
// oversigten vises kun hvis der faktisk er nogen — de fleste virksomheder har
// ingen.
export const REMOVED_STATUS = 'removed' as const satisfies ParcelStatus

export const BOARD_STATUSES: readonly ParcelStatus[] = [
  ...OPEN_STATUSES,
  ...TERMINAL_STATUSES,
  REMOVED_STATUS,
]

// Kasserne viser kun det seneste døgn: hvad der blev afsluttet i dag er drift,
// resten er historik (og ligger på /parcels/overview og Statistik).
export const TERMINAL_WINDOW_HOURS = 24

// Tidsvinduer man kan udvide en afsluttet kategori til (timer; 0 = vis alle).
export const WINDOWS = [24, 168, 720, 0] as const

export const windowLabelKey = (hours: number) =>
  hours === 24
    ? 'board.window24h'
    : hours === 168
      ? 'board.window7d'
      : hours === 720
        ? 'board.window30d'
        : 'board.windowAll'

export function isBoardStatus(value: unknown): value is ParcelStatus {
  return typeof value === 'string' && (BOARD_STATUSES as readonly string[]).includes(value)
}

// "Afsluttet" i listens forstand: sorteres/filtreres på updated_at og har
// tidsvindue-vælgeren. Gælder også 'removed'.
export function isTerminalStatus(status: ParcelStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status) || status === REMOVED_STATUS
}

// Standard-tidsvindue når kategorien åbnes uden ?hours. Udleveret/returneret er
// drift (seneste døgn); fjernede er en fejlliste man vil se hele vejen tilbage.
export function defaultWindowHours(status: ParcelStatus): number {
  if (status === REMOVED_STATUS) return 0
  return isTerminalStatus(status) ? TERMINAL_WINDOW_HOURS : 0
}

// Kategorifarver til cirklen: --chart-1..5 fra index.css i FAST slot-rækkefølge
// (samme palet som Statistik — CVD-valideret i både lys og mørk tilstand). Vi
// bruger med vilje ikke statusbadge-farverne her: de genbruger samme farve til
// flere statusser (fx registered/in_transit), hvilket ville gøre to lagkage-
// stykker umulige at skelne.
export const OPEN_STATUS_CHART_COLOR: Record<(typeof OPEN_STATUSES)[number], string> = {
  unassigned: 'var(--chart-1)',
  registered: 'var(--chart-2)',
  in_storage: 'var(--chart-3)',
  in_transit: 'var(--chart-4)',
  in_locker: 'var(--chart-5)',
}

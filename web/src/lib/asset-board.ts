import type { AssetStatus } from '@/components/asset-status-badge'

// Fælles definitioner for aktivoversigten (/assets/board): de aktive statusser
// (cirklen) og den udfasede kasse. Samme idé som parcel-board.ts — overbliks-
// og listekomponenten deler ét katalog, og et Link til en kategori valideres
// ét sted. Aktiver har ingen tidsvinduer: statusserne er tilstande, ikke
// gennemløb, så hver liste viser altid alle aktiver i tilstanden.

export const ACTIVE_ASSET_STATUSES = [
  'in_stock',
  'assigned',
  'on_loan',
  'service',
] as const satisfies readonly AssetStatus[]

export const RETIRED_STATUS = 'retired' as const satisfies AssetStatus

// Afskrevet: aktivet kom aldrig tilbage, og kravet er opgivet. Egen kasse på
// oversigten (som udfasede) — det er et tab, ikke en driftskategori.
export const WRITTEN_OFF_STATUS = 'written_off' as const satisfies AssetStatus

export const ASSET_BOARD_STATUSES: readonly AssetStatus[] = [
  ...ACTIVE_ASSET_STATUSES,
  RETIRED_STATUS,
  WRITTEN_OFF_STATUS,
]

export function isAssetBoardStatus(value: unknown): value is AssetStatus {
  return typeof value === 'string' && (ASSET_BOARD_STATUSES as readonly string[]).includes(value)
}

// Kategorifarver til cirklen: --chart-1..4 i fast slot-rækkefølge (samme
// CVD-validerede palet som pakkeoversigten) — bevidst ikke badge-farverne.
export const ASSET_STATUS_CHART_COLOR: Record<(typeof ACTIVE_ASSET_STATUSES)[number], string> = {
  in_stock: 'var(--chart-1)',
  assigned: 'var(--chart-2)',
  on_loan: 'var(--chart-3)',
  service: 'var(--chart-4)',
}

// Udfasningsårsager (preset-nøgler — samme sæt som retire_asset-RPC'ens check,
// så den immutable hændelseslog holdes fri for fritekst).
export const RETIRE_REASONS = ['sold', 'scrapped', 'lost', 'damaged', 'other'] as const
export type RetireReason = (typeof RETIRE_REASONS)[number]

export const retireReasonLabelKey: Record<RetireReason, string> = {
  sold: 'assetFlow.retireReasonSold',
  scrapped: 'assetFlow.retireReasonScrapped',
  lost: 'assetFlow.retireReasonLost',
  damaged: 'assetFlow.retireReasonDamaged',
  other: 'assetFlow.retireReasonOther',
}

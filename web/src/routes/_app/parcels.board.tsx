import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { ParcelStatus } from '@/components/parcel-status-badge'
import { ParcelBoardOverview } from '@/components/parcel-board-overview'
import { ParcelStatusList } from '@/components/parcel-status-list'
import { defaultWindowHours, isBoardStatus } from '@/lib/parcel-board'

// Pakkeoversigt. Én rute, to visninger — styret af ?status:
//   • uden status: overblikket (cirkel over de aktive + to kasser over det
//     seneste døgns afsluttede),
//   • med status: pakkerne i netop den kategori (søg/scan, batchvisning, sider).
// Bevidst samme rute, så et klik i cirklen giver en rigtig URL man kan gå tilbage
// fra, uden at rollestyringen (canAccessPath på /parcels/board) skal udvides.
export const Route = createFileRoute('/_app/parcels/board')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { status?: ParcelStatus; hours?: number } => {
    if (!isBoardStatus(search.status)) return {}
    const hours = Number(search.hours)
    return {
      status: search.status,
      hours: Number.isFinite(hours) && hours >= 0 ? hours : undefined,
    }
  },
  component: BoardPage,
})

function BoardPage() {
  const { status, hours } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  if (!status) return <ParcelBoardOverview />

  return (
    <ParcelStatusList
      // Ny kategori = ny liste: søgning, side og batchopslag skal ikke følge med.
      key={status}
      status={status}
      hours={hours ?? defaultWindowHours(status)}
      onHoursChange={(h) => navigate({ search: { status, hours: h }, replace: true })}
    />
  )
}

import { createFileRoute } from '@tanstack/react-router'
import type { AssetStatus } from '@/components/asset-status-badge'
import { AssetBoardOverview } from '@/components/asset-board-overview'
import { AssetStatusList } from '@/components/asset-status-list'
import { isAssetBoardStatus } from '@/lib/asset-board'

// Aktivoversigten: uden ?status vises overblikket (cirkel + udfaset-kasse);
// med ?status vises kategoriens liste. Én rute, så et klik giver en rigtig
// URL med tilbage-navigation, og rollegatingen er ét præfiks (som /parcels/board).

export const Route = createFileRoute('/_app/assets/board')({
  validateSearch: (search: Record<string, unknown>): { status?: AssetStatus } => {
    if (!isAssetBoardStatus(search.status)) return {}
    return { status: search.status }
  },
  component: BoardPage,
})

function BoardPage() {
  const { status } = Route.useSearch()
  if (!status) return <AssetBoardOverview />
  return <AssetStatusList key={status} status={status} />
}

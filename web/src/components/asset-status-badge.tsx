import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import type { Database } from '@/lib/database.types'

type AssetStatus = Database['public']['Enums']['asset_status']

// Samme statuspalette som pakkebadges (--status-*): grønt = klar/i mål,
// sand/orange = ude af huset og skal tilbage, dæmpet = ude af drift.
const statusColor: Record<AssetStatus, string> = {
  in_stock: 'var(--status-good)',
  assigned: '#13315C',
  on_loan: 'var(--status-good-to-neutral)',
  service: 'var(--status-neutral-to-bad)',
  retired: 'var(--status-bad)',
}

const statusLabelKey: Record<AssetStatus, string> = {
  in_stock: 'assetsPage.statusInStock',
  assigned: 'assetsPage.statusAssigned',
  on_loan: 'assetsPage.statusOnLoan',
  service: 'assetsPage.statusService',
  retired: 'assetsPage.statusRetired',
}

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  const { t } = useTranslation()
  return (
    <Badge className="rounded-[4px] text-white" style={{ backgroundColor: statusColor[status] }}>
      {t(statusLabelKey[status])}
    </Badge>
  )
}

export { statusLabelKey }
export type { AssetStatus }

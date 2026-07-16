import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import type { Database } from '@/lib/database.types'

type ParcelStatus = Database['public']['Enums']['parcel_status']

// Statuspaletten fra compliance-circle (--status-*) mapper pakkens tilstand:
// grønt = i mål, sand/orange = undervejs/kræver handling, rød = undtagelser.
const statusColor: Record<ParcelStatus, string> = {
  unassigned: 'var(--status-bad)',
  registered: '#13315C',
  in_storage: 'var(--status-good-to-neutral)',
  in_transit: '#13315C',
  in_locker: 'var(--status-good-to-neutral)',
  delivered: 'var(--status-good)',
  rejected: 'var(--status-neutral-to-bad)',
  returned: 'var(--status-bad)',
}

const statusLabelKey: Record<ParcelStatus, string> = {
  unassigned: 'dashboard.statusUnassigned',
  registered: 'dashboard.statusRegistered',
  in_storage: 'dashboard.statusInStorage',
  in_transit: 'dashboard.statusInTransit',
  in_locker: 'dashboard.statusInLocker',
  delivered: 'dashboard.statusDelivered',
  rejected: 'dashboard.statusRejected',
  returned: 'dashboard.statusReturned',
}

export function ParcelStatusBadge({ status }: { status: ParcelStatus }) {
  const { t } = useTranslation()
  return (
    <Badge
      className="rounded-[4px] text-white"
      style={{ backgroundColor: statusColor[status] }}
    >
      {t(statusLabelKey[status])}
    </Badge>
  )
}

export { statusLabelKey, statusColor }
export type { ParcelStatus }

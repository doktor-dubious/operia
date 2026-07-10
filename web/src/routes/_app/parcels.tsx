import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { ParcelStatusBadge } from '@/components/parcel-status-badge'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/parcels')({
  component: ParcelsPage,
})

const dateFormat = new Intl.DateTimeFormat('da-DK', {
  dateStyle: 'short',
  timeStyle: 'short',
})

function ParcelsPage() {
  const { t } = useTranslation()

  const { data, isPending } = useQuery({
    queryKey: ['parcels'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parcels')
        .select(
          `id, barcode, status, registered_at,
           receiver:employees (full_name),
           department:departments (name),
           location:storage_locations (name)`,
        )
        .order('registered_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data
    },
  })

  if (isPending) return <Skeleton className="h-40 w-full" />

  if (!data?.length) {
    return <p className="text-sm text-muted-foreground">{t('parcels.empty')}</p>
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-panel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('parcels.barcode')}</TableHead>
            <TableHead>{t('parcels.receiver')}</TableHead>
            <TableHead>{t('parcels.department')}</TableHead>
            <TableHead>{t('parcels.status')}</TableHead>
            <TableHead>{t('parcels.location')}</TableHead>
            <TableHead>{t('parcels.registeredAt')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((parcel) => (
            <TableRow key={parcel.id} className="hover:bg-table-row-hover">
              <TableCell className="font-mono text-xs">{parcel.barcode ?? '—'}</TableCell>
              <TableCell>{parcel.receiver?.full_name ?? '—'}</TableCell>
              <TableCell>{parcel.department?.name ?? '—'}</TableCell>
              <TableCell>
                <ParcelStatusBadge status={parcel.status} />
              </TableCell>
              <TableCell>{parcel.location?.name ?? '—'}</TableCell>
              <TableCell>{dateFormat.format(new Date(parcel.registered_at))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

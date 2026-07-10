import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { ParcelStatusBadge } from '@/components/parcel-status-badge'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/parcels/')({
  component: ParcelsPage,
})

const dateFormat = new Intl.DateTimeFormat('da-DK', {
  dateStyle: 'short',
  timeStyle: 'short',
})

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows() {
  return useQuery({
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
        .limit(500)
      if (error) throw error
      return data
    },
  })
}

function ParcelsPage() {
  const { t } = useTranslation()
  const { data, isPending } = useRows()

  if (isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    {
      key: 'barcode',
      header: t('parcels.barcode'),
      sortable: true,
      sortValue: (r) => r.barcode,
      render: (r) => <span className="font-mono text-xs">{r.barcode ?? '—'}</span>,
    },
    {
      key: 'receiver',
      header: t('parcels.receiver'),
      sortable: true,
      sortValue: (r) => r.receiver?.full_name ?? null,
      render: (r) => r.receiver?.full_name ?? '—',
    },
    {
      key: 'department',
      header: t('parcels.department'),
      sortable: true,
      sortValue: (r) => r.department?.name ?? null,
      render: (r) => r.department?.name ?? '—',
    },
    {
      key: 'status',
      header: t('parcels.status'),
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => <ParcelStatusBadge status={r.status} />,
    },
    {
      key: 'location',
      header: t('parcels.location'),
      sortable: true,
      sortValue: (r) => r.location?.name ?? null,
      render: (r) => r.location?.name ?? '—',
    },
    {
      key: 'registered_at',
      header: t('parcels.registeredAt'),
      sortable: true,
      sortValue: (r) => r.registered_at,
      render: (r) => dateFormat.format(new Date(r.registered_at)),
    },
  ]

  // Bevidst ingen onDelete: pakker må ikke slettes fra klienter
  // (ingen delete-policy/grant) — sporbarheden er hele produktet.
  return (
    <DataTable
      rows={data ?? []}
      columns={columns}
      entityLabel={t('nav.parcels').toLowerCase()}
      searchText={(row) =>
        [row.barcode, row.receiver?.full_name, row.department?.name, row.location?.name]
          .filter(Boolean)
          .join(' ')
      }
      storageKey="parcels"
    />
  )
}

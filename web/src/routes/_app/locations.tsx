import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/locations')({
  component: LocationsPage,
})

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows() {
  return useQuery({
    queryKey: ['storage-locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('storage_locations')
        .select('id, name, barcode, is_active')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function LocationsPage() {
  const { t } = useTranslation()
  const { data, isPending } = useRows()

  const queryClient = useQueryClient()
  const deleteRows = async (ids: string[]) => {
    const { error } = await supabase.from('storage_locations').delete().in('id', ids)
    if (error) throw error
    await queryClient.invalidateQueries({ queryKey: ['storage-locations'] })
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    { key: 'name', header: t('locations.name'), sortable: true, sortValue: (r) => r.name },
    { key: 'barcode', header: t('locations.barcode'), sortable: true, sortValue: (r) => r.barcode, render: (r) => <span className="font-mono text-xs">{r.barcode ?? '—'}</span> },
    { key: 'is_active', header: t('locations.active'), sortable: true, sortValue: (r) => (r.is_active ? 1 : 0), render: (r) => (r.is_active ? t('common.yes') : t('common.no')) },
  ]

  return (
    <DataTable
      rows={data ?? []}
      columns={columns}
      entityLabel={t('nav.locations').toLowerCase()}
      searchText={(row) => [row.name, row.barcode].filter(Boolean).join(' ')}
      storageKey="storage-locations"
      onDelete={deleteRows}
    />
  )
}

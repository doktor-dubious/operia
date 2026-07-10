import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/carriers')({
  component: CarriersPage,
})

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows() {
  return useQuery({
    queryKey: ['carriers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carriers')
        .select('id, name, is_active')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function CarriersPage() {
  const { t } = useTranslation()
  const { data, isPending } = useRows()

  const queryClient = useQueryClient()
  const deleteRows = async (ids: string[]) => {
    const { error } = await supabase.from('carriers').delete().in('id', ids)
    if (error) throw error
    await queryClient.invalidateQueries({ queryKey: ['carriers'] })
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    { key: 'name', header: t('carriersPage.name'), sortable: true, sortValue: (r) => r.name },
    { key: 'is_active', header: t('carriersPage.active'), sortable: true, sortValue: (r) => (r.is_active ? 1 : 0), render: (r) => (r.is_active ? t('common.yes') : t('common.no')) },
  ]

  return (
    <DataTable
      rows={data ?? []}
      columns={columns}
      entityLabel={t('nav.carriers').toLowerCase()}
      searchText={(row) => row.name}
      storageKey="carriers"
      onDelete={deleteRows}
    />
  )
}

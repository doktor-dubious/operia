import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/handling-classes')({
  component: HandlingClassesPage,
})

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows() {
  return useQuery({
    queryKey: ['handling-classes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('handling_classes')
        .select('id, name, allow_proxy_collection, allow_leave_at_location, description')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function HandlingClassesPage() {
  const { t } = useTranslation()
  const { data, isPending } = useRows()

  const queryClient = useQueryClient()
  const deleteRows = async (ids: string[]) => {
    const { error } = await supabase.from('handling_classes').delete().in('id', ids)
    if (error) throw error
    await queryClient.invalidateQueries({ queryKey: ['handling-classes'] })
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    { key: 'name', header: t('handlingClasses.name'), sortable: true, sortValue: (r) => r.name },
    { key: 'proxy', header: t('handlingClasses.allowProxy'), sortable: true, sortValue: (r) => (r.allow_proxy_collection ? 1 : 0), render: (r) => (r.allow_proxy_collection ? t('common.yes') : t('common.no')) },
    { key: 'leave', header: t('handlingClasses.allowLeave'), sortable: true, sortValue: (r) => (r.allow_leave_at_location ? 1 : 0), render: (r) => (r.allow_leave_at_location ? t('common.yes') : t('common.no')) },
    { key: 'description', header: t('handlingClasses.description'), render: (r) => <span className="text-muted-foreground">{r.description ?? '—'}</span> },
  ]

  return (
    <DataTable
      rows={data ?? []}
      columns={columns}
      entityLabel={t('nav.handlingClasses').toLowerCase()}
      searchText={(row) => [row.name, row.description].filter(Boolean).join(' ')}
      storageKey="handling-classes"
      onDelete={deleteRows}
    />
  )
}

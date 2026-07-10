import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/departments')({
  component: DepartmentsPage,
})

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows() {
  return useQuery({
    queryKey: ['departments-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name, employees (count)')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function DepartmentsPage() {
  const { t } = useTranslation()
  const { data, isPending } = useRows()

  const queryClient = useQueryClient()
  const deleteRows = async (ids: string[]) => {
    const { error } = await supabase.from('departments').delete().in('id', ids)
    if (error) throw error
    await queryClient.invalidateQueries({ queryKey: ['departments-list'] })
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    { key: 'name', header: t('departments.name'), sortable: true, sortValue: (r) => r.name },
    { key: 'count', header: t('departments.employeeCount'), sortable: true, sortValue: (r) => r.employees?.[0]?.count ?? 0, render: (r) => r.employees?.[0]?.count ?? 0 },
  ]

  return (
    <DataTable
      rows={data ?? []}
      columns={columns}
      entityLabel={t('nav.departments').toLowerCase()}
      searchText={(row) => row.name}
      storageKey="departments-list"
      onDelete={deleteRows}
    />
  )
}

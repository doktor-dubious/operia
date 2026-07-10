import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/employees')({
  component: EmployeesPage,
})

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, full_name, initials, email, is_active, department:departments (name)')
        .order('full_name')
      if (error) throw error
      return data
    },
  })
}

function EmployeesPage() {
  const { t } = useTranslation()
  const { data, isPending } = useRows()

  const queryClient = useQueryClient()
  const deleteRows = async (ids: string[]) => {
    const { error } = await supabase.from('employees').delete().in('id', ids)
    if (error) throw error
    await queryClient.invalidateQueries({ queryKey: ['employees'] })
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    { key: 'full_name', header: t('employees.name'), sortable: true, sortValue: (r) => r.full_name },
    { key: 'initials', header: t('employees.initials'), sortable: true, sortValue: (r) => r.initials, render: (r) => r.initials ?? '—' },
    { key: 'department', header: t('employees.department'), sortable: true, sortValue: (r) => r.department?.name ?? null, render: (r) => r.department?.name ?? '—' },
    { key: 'email', header: t('employees.email'), sortable: true, sortValue: (r) => r.email, render: (r) => r.email ?? '—' },
    { key: 'is_active', header: t('employees.active'), sortable: true, sortValue: (r) => (r.is_active ? 1 : 0), render: (r) => (r.is_active ? t('common.yes') : t('common.no')) },
  ]

  return (
    <DataTable
      rows={data ?? []}
      columns={columns}
      entityLabel={t('nav.employees').toLowerCase()}
      searchText={(row) => [row.full_name, row.initials, row.email, row.department?.name].filter(Boolean).join(' ')}
      storageKey="employees"
      onDelete={deleteRows}
    />
  )
}

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
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/employees')({
  component: EmployeesPage,
})

function EmployeesPage() {
  const { t } = useTranslation()

  const { data, isPending } = useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, full_name, initials, email, is_active, department:departments (name)')
        .order('full_name')
        .limit(200)
      if (error) throw error
      return data
    },
  })

  if (isPending) return <Skeleton className="h-40 w-full" />

  if (!data?.length) {
    return <p className="text-sm text-muted-foreground">{t('employees.empty')}</p>
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-panel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('employees.name')}</TableHead>
            <TableHead>{t('employees.initials')}</TableHead>
            <TableHead>{t('employees.department')}</TableHead>
            <TableHead>{t('employees.email')}</TableHead>
            <TableHead>{t('employees.active')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((employee) => (
            <TableRow key={employee.id} className="hover:bg-table-row-hover">
              <TableCell>{employee.full_name}</TableCell>
              <TableCell>{employee.initials ?? '—'}</TableCell>
              <TableCell>{employee.department?.name ?? '—'}</TableCell>
              <TableCell>{employee.email ?? '—'}</TableCell>
              <TableCell>{employee.is_active ? t('common.yes') : t('common.no')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

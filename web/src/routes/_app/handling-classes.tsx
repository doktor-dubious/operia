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

export const Route = createFileRoute('/_app/handling-classes')({
  component: HandlingClassesPage,
})

function HandlingClassesPage() {
  const { t } = useTranslation()

  const { data, isPending } = useQuery({
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

  if (isPending) return <Skeleton className="h-40 w-full" />

  if (!data?.length) {
    return <p className="text-sm text-muted-foreground">{t('handlingClasses.empty')}</p>
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-panel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('handlingClasses.name')}</TableHead>
            <TableHead>{t('handlingClasses.allowProxy')}</TableHead>
            <TableHead>{t('handlingClasses.allowLeave')}</TableHead>
            <TableHead>{t('handlingClasses.description')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((hc) => (
            <TableRow key={hc.id} className="hover:bg-table-row-hover">
              <TableCell>{hc.name}</TableCell>
              <TableCell>{hc.allow_proxy_collection ? t('common.yes') : t('common.no')}</TableCell>
              <TableCell>{hc.allow_leave_at_location ? t('common.yes') : t('common.no')}</TableCell>
              <TableCell className="text-muted-foreground">{hc.description ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

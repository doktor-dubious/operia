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

export const Route = createFileRoute('/_app/carriers')({
  component: CarriersPage,
})

function CarriersPage() {
  const { t } = useTranslation()

  const { data, isPending } = useQuery({
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

  if (isPending) return <Skeleton className="h-40 w-full" />

  if (!data?.length) {
    return <p className="text-sm text-muted-foreground">{t('carriersPage.empty')}</p>
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-panel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('carriersPage.name')}</TableHead>
            <TableHead>{t('carriersPage.active')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((carrier) => (
            <TableRow key={carrier.id} className="hover:bg-table-row-hover">
              <TableCell>{carrier.name}</TableCell>
              <TableCell>{carrier.is_active ? t('common.yes') : t('common.no')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

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

export const Route = createFileRoute('/_app/locations')({
  component: LocationsPage,
})

function LocationsPage() {
  const { t } = useTranslation()

  const { data, isPending } = useQuery({
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

  if (isPending) return <Skeleton className="h-40 w-full" />

  if (!data?.length) {
    return <p className="text-sm text-muted-foreground">{t('locations.empty')}</p>
  }

  return (
    <div className="overflow-x-auto rounded-md border bg-panel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('locations.name')}</TableHead>
            <TableHead>{t('locations.barcode')}</TableHead>
            <TableHead>{t('locations.active')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((location) => (
            <TableRow key={location.id} className="hover:bg-table-row-hover">
              <TableCell>{location.name}</TableCell>
              <TableCell className="font-mono text-xs">{location.barcode ?? '—'}</TableCell>
              <TableCell>{location.is_active ? t('common.yes') : t('common.no')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

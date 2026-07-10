import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { statusLabelKey, type ParcelStatus } from '@/components/parcel-status-badge'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/')({
  component: DashboardPage,
})

const openStatuses: ParcelStatus[] = [
  'unassigned',
  'registered',
  'in_storage',
  'in_transit',
  'in_locker',
]

function DashboardPage() {
  const { t } = useTranslation()

  const { data, isPending } = useQuery({
    queryKey: ['parcel-status-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('parcels').select('status')
      if (error) throw error
      const counts = new Map<ParcelStatus, number>()
      for (const row of data) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
      }
      return counts
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          {t('dashboard.openParcels')}
        </h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {openStatuses.map((status) => (
            <Card key={status} className="bg-panel">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-normal text-muted-foreground">
                  {t(statusLabelKey[status])}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isPending ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <span className="text-2xl font-semibold">{data?.get(status) ?? 0}</span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}

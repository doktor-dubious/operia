import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Importloggen = Manager-alarmfladen fra spec'en: alle kørsler, også
// afviste/fejlede, med tællinger og hvem der kørte dem.
export const Route = createFileRoute('/_app/import/log')({
  component: ImportLogPage,
})

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

function ImportLogPage() {
  const { t } = useTranslation()
  const { data: access } = useAccess()
  const { companyId } = useCompanyContext()

  const { data, isPending } = useQuery({
    queryKey: ['import-runs', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_runs')
        .select('*')
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data
    },
  })

  if (access && !access.isManager && !access.isPlatformAdmin) {
    return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  }
  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium">{t('importPage.logTitle')}</h1>
        <p className="mt-0.5 text-[13px] text-foreground-light">{t('importPage.logSubtitle')}</p>
      </div>
      {data?.length ? (
        <div className="overflow-x-auto rounded-md border bg-panel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('importPage.historyDate')}</TableHead>
                <TableHead>{t('importPage.historyFile')}</TableHead>
                <TableHead>{t('importPage.historyBy')}</TableHead>
                <TableHead>{t('importPage.historyStatus')}</TableHead>
                <TableHead>{t('importPage.historyResult')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((run) => (
                <TableRow key={run.id} className="hover:bg-table-row-hover">
                  <TableCell>{dateFormat.format(new Date(run.created_at))}</TableCell>
                  <TableCell className="max-w-40 truncate">{run.file_name ?? '—'}</TableCell>
                  <TableCell className="max-w-44 truncate">{run.created_by_email ?? '—'}</TableCell>
                  <TableCell
                    className={cn(
                      run.status === 'applied' && 'text-status-good-to-neutral',
                      run.status === 'rejected' && 'text-status-neutral-to-bad',
                      run.status === 'failed' && 'text-destructive',
                    )}
                  >
                    {t(`importPage.status${run.status.charAt(0).toUpperCase()}${run.status.slice(1)}`)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t('importPage.resultSummary', {
                      created: run.created_count,
                      updated: run.updated_count,
                      deactivated: run.deactivated_count,
                      rejected: run.rejected_count,
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('importPage.historyEmpty')}</p>
      )}
    </div>
  )
}

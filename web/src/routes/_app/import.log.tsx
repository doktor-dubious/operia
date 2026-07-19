import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { useCompanyContext } from '@/hooks/use-company-context'
import { summarizeReasons } from '@/lib/import-reasons'
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
  const { companyId } = useCompanyContext()

  const { data, isPending } = useQuery({
    queryKey: ['import-runs', companyId],
    enabled: !!companyId,
    // Loggen skal altid vise nyeste kørsler: hent friskt hver gang siden
    // åbnes, så en netop kørt import straks dukker op som en ny række.
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_runs')
        .select('*')
        .eq('company_id', companyId!)
        // kun medarbejderkørsler — aktiv-/lagerimport har egne logs
        .eq('kind', 'employees_csv')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data
    },
  })

  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

  type Run = NonNullable<typeof data>[number]
  const statusLabel = (run: Run) =>
    t(`importPage.status${run.status.charAt(0).toUpperCase()}${run.status.slice(1)}`)
  const resultLabel = (run: Run) => {
    if (run.status === 'exported') return t('exportPage.exportedResult', { count: run.rows_total })
    // Fil-niveau-afvisning/-fejl (fx SFTP/e-mail): vis den oversatte årsag.
    if (run.status === 'rejected' || run.status === 'failed') {
      const reason = summarizeReasons(run.errors, t)
      if (reason) return reason
    }
    return t('importPage.resultSummary', {
      created: run.created_count,
      updated: run.updated_count,
      deactivated: run.deactivated_count,
      rejected: run.rejected_count,
    })
  }

  const columns: ColumnDef<Run>[] = [
    {
      key: 'created_at',
      header: t('importPage.historyDate'),
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => dateFormat.format(new Date(r.created_at)),
    },
    {
      key: 'file_name',
      header: t('importPage.historyFile'),
      sortable: true,
      sortValue: (r) => r.file_name,
      render: (r) => <span className="block max-w-40 truncate">{r.file_name ?? '—'}</span>,
    },
    {
      key: 'created_by_email',
      header: t('importPage.historyBy'),
      sortable: true,
      sortValue: (r) => r.created_by_email,
      render: (r) => <span className="block max-w-44 truncate">{r.created_by_email ?? '—'}</span>,
    },
    {
      key: 'status',
      header: t('importPage.historyStatus'),
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <span
          className={cn(
            r.status === 'applied' && 'text-status-good-to-neutral',
            r.status === 'exported' && 'text-status-good-to-neutral',
            r.status === 'rejected' && 'text-status-neutral-to-bad',
            r.status === 'failed' && 'text-destructive',
          )}
        >
          {statusLabel(r)}
        </span>
      ),
    },
    {
      key: 'result',
      header: t('importPage.historyResult'),
      render: (r) => <span className="text-muted-foreground">{resultLabel(r)}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium">{t('importPage.logTitle')}</h1>
        <p className="mt-0.5 text-[13px] text-foreground-light">{t('importPage.logSubtitle')}</p>
      </div>
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('importPage.runsEntity')}
        searchText={(r) =>
          [r.file_name, r.created_by_email, statusLabel(r)].filter(Boolean).join(' ')
        }
        storageKey="import-log"
      />
    </div>
  )
}

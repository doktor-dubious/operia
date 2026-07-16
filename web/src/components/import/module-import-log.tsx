import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { summarizeReasons } from '@/lib/import-reasons'
import type { ModuleSpec } from '@/lib/module-import'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Importloggen for modulet = Manager-alarmfladen (og aktivitetsrapport):
// en samlet tidslinje over BÅDE importkørsler (import_runs, filtreret på kind)
// OG konfigurationsændringer (audit_log, entity_type='import_config' for
// modulets import_type). Begge skrives server-side; her flettes de.
const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

type Tone = 'good' | 'warn' | 'bad' | 'muted'
type Entry = {
  id: string
  at: string
  kind: 'import' | 'export' | 'config'
  target: string
  by: string | null
  statusLabel: string
  tone: Tone
  result: string
}

const toneClass: Record<Tone, string> = {
  good: 'text-status-good-to-neutral',
  warn: 'text-status-neutral-to-bad',
  bad: 'text-destructive',
  muted: 'text-muted-foreground',
}

export function ModuleImportLog({ spec }: { spec: ModuleSpec }) {
  const { t } = useTranslation()
  const { data: access } = useAccess()
  const { companyId } = useCompanyContext()

  const { data, isPending } = useQuery({
    queryKey: ['import-runs', companyId, spec.runKind],
    enabled: !!companyId,
    // Loggen skal altid vise nyeste aktivitet: hent friskt hver gang.
    refetchOnMount: 'always',
    queryFn: async () => {
      const [runs, configs, users] = await Promise.all([
        supabase
          .from('import_runs')
          .select('*')
          .eq('company_id', companyId!)
          .eq('kind', spec.runKind)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('audit_log')
          .select('id, created_at, action, actor_user_id, detail')
          .eq('company_id', companyId!)
          .eq('entity_type', 'import_config')
          .eq('entity_id', spec.importType)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.from('app_users').select('user_id, email').eq('company_id', companyId!),
      ])
      if (runs.error) throw runs.error
      if (configs.error) throw configs.error
      if (users.error) throw users.error
      return { runs: runs.data, configs: configs.data, users: users.data }
    },
  })

  if (access && !access.isManager && !access.isPlatformAdmin) {
    return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  }
  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

  const emailByUser = new Map((data?.users ?? []).map((u) => [u.user_id, u.email]))

  const importStatus: Record<string, { label: string; tone: Tone }> = {
    applied: { label: t('importPage.statusApplied'), tone: 'good' },
    exported: { label: t('exportPage.statusExported'), tone: 'good' },
    rejected: { label: t('importPage.statusRejected'), tone: 'warn' },
    failed: { label: t('importPage.statusFailed'), tone: 'bad' },
  }
  const configAction: Record<string, { label: string; tone: Tone }> = {
    created: { label: t('moduleImport.common.configCreated'), tone: 'good' },
    updated: { label: t('moduleImport.common.configUpdated'), tone: 'warn' },
    deleted: { label: t('moduleImport.common.configDeleted'), tone: 'bad' },
  }

  const entries: Entry[] = [
    ...(data?.runs ?? []).map((r): Entry => {
      const st = importStatus[r.status] ?? { label: r.status, tone: 'muted' as Tone }
      return {
        id: `run-${r.id}`,
        at: r.created_at,
        kind: r.status === 'exported' ? 'export' : 'import',
        target: r.file_name ?? '—',
        by: r.created_by_email,
        statusLabel: st.label,
        tone: st.tone,
        result:
          r.status === 'exported'
            ? t('exportPage.exportedResult', { count: r.rows_total })
            : (r.status === 'rejected' || r.status === 'failed') && summarizeReasons(r.errors, t)
              ? summarizeReasons(r.errors, t)
              : t('importPage.resultSummary', {
                  created: r.created_count,
                  updated: r.updated_count,
                  deactivated: r.deactivated_count,
                  rejected: r.rejected_count,
                }),
      }
    }),
    ...(data?.configs ?? []).map((c): Entry => {
      const verb = c.action.replace('import_config.', '')
      const act = configAction[verb] ?? { label: verb, tone: 'muted' as Tone }
      const detail = (c.detail ?? {}) as { separator?: string; fields?: string[] }
      const fieldCount = Array.isArray(detail.fields) ? detail.fields.length : 0
      return {
        id: `cfg-${c.id}`,
        at: c.created_at,
        kind: 'config',
        target: t('moduleImport.common.configTarget'),
        by: c.actor_user_id ? (emailByUser.get(c.actor_user_id) ?? null) : null,
        statusLabel: act.label,
        tone: act.tone,
        result: t('moduleImport.common.configSummary', {
          count: fieldCount,
          sep: detail.separator === '\t' ? t('importPage.tabSeparator') : (detail.separator ?? '—'),
        }),
      }
    }),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))

  const typeLabel = (e: Entry) =>
    e.kind === 'import'
      ? t('moduleImport.common.typeImport')
      : e.kind === 'export'
        ? t('moduleImport.common.typeExport')
        : t('moduleImport.common.typeConfig')

  const columns: ColumnDef<Entry>[] = [
    {
      key: 'at',
      header: t('importPage.historyDate'),
      sortable: true,
      sortValue: (r) => r.at,
      render: (r) => dateFormat.format(new Date(r.at)),
    },
    {
      key: 'kind',
      header: t('moduleImport.common.colType'),
      sortable: true,
      sortValue: (r) => r.kind,
      render: (r) => (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {typeLabel(r)}
        </span>
      ),
    },
    {
      key: 'target',
      header: t('moduleImport.common.colTarget'),
      sortable: true,
      sortValue: (r) => r.target,
      render: (r) => <span className="block max-w-40 truncate">{r.target}</span>,
    },
    {
      key: 'by',
      header: t('importPage.historyBy'),
      sortable: true,
      sortValue: (r) => r.by,
      render: (r) => <span className="block max-w-44 truncate">{r.by ?? '—'}</span>,
    },
    {
      key: 'status',
      header: t('importPage.historyStatus'),
      sortable: true,
      sortValue: (r) => r.statusLabel,
      render: (r) => <span className={cn(toneClass[r.tone])}>{r.statusLabel}</span>,
    },
    {
      key: 'result',
      header: t('importPage.historyResult'),
      render: (r) => <span className="text-muted-foreground">{r.result}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-medium">{t(`${spec.i18nKey}.logTitle`)}</h1>
        <p className="mt-0.5 text-[13px] text-foreground-light">{t(`${spec.i18nKey}.logSubtitle`)}</p>
      </div>
      <DataTable
        rows={entries}
        columns={columns}
        entityLabel={t('importPage.runsEntity')}
        searchText={(r) => [typeLabel(r), r.target, r.by, r.statusLabel, r.result].filter(Boolean).join(' ')}
        storageKey={`import-log-${spec.module}`}
      />
    </div>
  )
}

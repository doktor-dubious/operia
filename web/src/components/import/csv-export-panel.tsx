import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useImportConfig, type ImportType } from '@/hooks/use-import-config'
import { useSession } from '@/hooks/use-session'
import { buildCsv, dateStamp, downloadCsv, type CsvRecord } from '@/lib/csv-export'
import { supabase } from '@/lib/supabase'

// Fælles eksport-side (Import/Eksport → Eksport). Henter virksomhedens
// importkonfiguration, læser de aktive rækker via `load`, bygger en CSV i
// nøjagtig samme format som importen forventer og logger kørslen i
// import_runs (status 'exported') — så eksporter dukker op i samme
// Import/Eksport-log som importerne.

export type ExportLoad = (
  companyId: string,
  fields: string[],
) => Promise<{ headerFor: (field: string) => string; records: CsvRecord[] }>

type Props = {
  importType: ImportType
  runKind: string // import_runs.kind (samme som modulets import → deles i loggen)
  defaultFields: string[] // fallback når ingen gemt konfiguration findes
  fileBase: string // filnavns-stamme, fx 'medarbejdere'
  title: string
  subtitle: string
  fieldLabel: (field: string) => string
  load: ExportLoad
}

export function CsvExportPanel({
  importType,
  runKind,
  defaultFields,
  fileBase,
  title,
  subtitle,
  fieldLabel,
  load,
}: Props) {
  const { t } = useTranslation()
  const { session } = useSession()
  const { data: access } = useAccess()
  const { companyId } = useCompanyContext()
  const { data: cfg, isPending: cfgPending } = useImportConfig(companyId, importType)
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  const format = useMemo(
    () => ({
      hasHeader: cfg?.has_header ?? true,
      hasFooter: cfg?.has_footer ?? false,
      separator: cfg?.separator ?? ',',
      fields: cfg?.fields ?? defaultFields,
    }),
    [cfg, defaultFields],
  )

  const { data: loaded, isPending: dataPending } = useQuery({
    queryKey: ['csv-export', importType, companyId, format.fields.join(',')],
    enabled: !!companyId && !cfgPending,
    refetchOnMount: 'always',
    queryFn: () => load(companyId!, format.fields),
  })

  if (access && !access.isManager && !access.isPlatformAdmin) {
    return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  }
  if (!companyId || cfgPending) return <Skeleton className="h-40 w-full" />

  const rowCount = loaded?.records.length ?? 0
  const separatorLabel = format.separator === '\t' ? t('importPage.tabSeparator') : format.separator

  const onExport = async () => {
    if (!loaded) return
    setBusy(true)
    try {
      const fileName = `${fileBase}-${dateStamp()}.csv`
      const csv = buildCsv(format, loaded.headerFor, loaded.records)
      downloadCsv(fileName, csv)
      const { error } = await supabase.from('import_runs').insert({
        company_id: companyId,
        kind: runKind,
        file_name: fileName,
        status: 'exported',
        rows_total: loaded.records.length,
        created_by: session?.user.id ?? null,
        created_by_email: session?.user.email ?? null,
      })
      if (error) console.error('Kunne ikke logge eksportkørsel:', error)
      queryClient.invalidateQueries({ queryKey: ['import-runs'] })
      toast.success(t('exportPage.exported', { count: loaded.records.length }))
    } catch (error) {
      console.error('Eksport fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-6">
      <header>
        <h1 className="text-2xl font-medium text-foreground">{title}</h1>
        <p className="mt-1 max-w-xl text-sm text-foreground-light">{subtitle}</p>
      </header>

      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('exportPage.formatTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[13px] sm:grid-cols-3">
            <div className="flex items-baseline justify-between gap-2 border-b border-border/50 py-1">
              <dt className="text-muted-foreground">{t('exportPage.rowCount')}</dt>
              <dd className="font-medium">{dataPending ? '…' : rowCount}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-b border-border/50 py-1">
              <dt className="text-muted-foreground">{t('importConfig.separator')}</dt>
              <dd className="font-mono font-medium">{separatorLabel}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-b border-border/50 py-1">
              <dt className="text-muted-foreground">{t('importConfig.hasHeader')}</dt>
              <dd className="font-medium">{format.hasHeader ? t('common.yes') : t('common.no')}</dd>
            </div>
          </dl>

          <div>
            <p className="mb-1.5 text-label">{t('exportPage.columns')}</p>
            <div className="flex flex-wrap gap-1.5">
              {format.fields.map((f, i) => (
                <span
                  key={f}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px]"
                >
                  <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                  {fieldLabel(f)}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onExport} disabled={busy || dataPending || !loaded}>
          <Download className="size-4" />
          {busy ? t('exportPage.exporting') : t('exportPage.exportButton')}
        </Button>
      </div>
    </div>
  )
}

import { useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FileUp, Play, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCompanyContext } from '@/hooks/use-company-context'
import {
  IMPORT_FIELDS,
  buildPayload,
  parseCsv,
  suggestMapping,
  type ImportField,
  type ImportResult,
  type ParsedFile,
} from '@/lib/booking-import'
import { invalidateBookingQueries } from '@/lib/booking'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Booking → Import (EVU-krav B-03): fil → kolonnemapning → tørkørsel → anvend.
//
// Tørkørslen er obligatorisk og kører i basen: den viser, række for række,
// hvad der vil ske (oprettes / opdateres / uændret / springes over og hvorfor),
// før noget skrives. "Anvend" er det samme kald med p_apply = true, så det,
// der blev vist, er det, der sker.
export const Route = createFileRoute('/_app/booking/import')({
  component: BookingImportPage,
})

const NONE = '__none__'

const ACTION_TONE: Record<string, string> = {
  create: 'bg-status-good/15 text-status-good',
  update: 'bg-primary/15 text-primary',
  unchanged: 'bg-muted text-muted-foreground',
  skip: 'bg-status-neutral-to-bad/15 text-status-neutral-to-bad',
}

function BookingImportPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [file, setFile] = useState<ParsedFile | null>(null)
  const [mapping, setMapping] = useState<(ImportField | null)[]>([])
  const [dryRun, setDryRun] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<ImportResult | null>(null)

  const onFile = async (f: File) => {
    const text = await f.text()
    const parsed = parseCsv(text)
    if (parsed.headers.length < 2 || parsed.rows.length === 0) {
      toast.error(t('bookingImport.parseError'))
      return
    }
    setFileName(f.name)
    setFile(parsed)
    setMapping(suggestMapping(parsed.headers))
    setDryRun(null)
    setReceipt(null)
  }

  const missingRequired = IMPORT_FIELDS.filter((f) => f.required && !mapping.includes(f.key)).map((f) => f.key)
  const hasTime = mapping.includes('starts_at') || mapping.includes('date')
  const ready = !!file && missingRequired.length === 0 && hasTime

  const run = async (apply: boolean) => {
    if (!file || !companyId) return
    setBusy(true)
    const payload = buildPayload(file, mapping)
    const { data, error } = await supabase.rpc('import_bookings', {
      p_company_id: companyId,
      p_rows: payload as unknown as import('@/lib/database.types').Json,
      p_apply: apply,
      p_file_name: fileName || undefined,
    })
    setBusy(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    const res = data as unknown as ImportResult
    if (!apply) {
      setDryRun(res)
      return
    }
    setReceipt(res)
    setDryRun(null)
    invalidateBookingQueries(queryClient)
    // Importloggen (import_runs, kind 'bookings_csv') skrives af RPC'en selv
    // med dens rettigheder — booking_manager har ikke indsæt på tabellen.
    void queryClient.invalidateQueries({ queryKey: ['import-runs'] })
    toast.success(t('bookingImport.appliedToast', { created: res.created, updated: res.updated, skipped: res.skipped }))
  }

  const shown = receipt ?? dryRun
  // Vises i virksomhedens tidszone — samme som filen blev læst i.
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Copenhagen' })

  // De seneste kørsler — samme log som medarbejder-, aktiv- og lagerimporten,
  // men vist her, hvor bookingimporten køres.
  const { data: runs } = useQuery({
    queryKey: ['import-runs', companyId, 'bookings_csv'],
    enabled: !!companyId,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_runs')
        .select('id, created_at, file_name, status, rows_total, created_count, updated_count, unchanged_count, rejected_count, created_by_email')
        .eq('company_id', companyId!)
        .eq('kind', 'bookings_csv')
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data
    },
  })

  return (
    <div className="flex min-h-full flex-col gap-6">
      <p className="max-w-2xl text-xs text-muted-foreground">{t('bookingImport.intro')}</p>

      {/* 1) Filen */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ''
          }}
        />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp className="size-4" /> {t('bookingImport.chooseFile')}
        </Button>
        {file && (
          <span className="text-xs text-muted-foreground">
            {t('bookingImport.fileInfo', { name: fileName, rows: file.rows.length, sep: file.delimiter === '\t' ? 'TAB' : file.delimiter })}
          </span>
        )}
      </div>

      {/* 2) Mapningen */}
      {file && (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <span className="text-[13px] font-[450]">{t('bookingImport.mappingTitle')}</span>
          <p className="text-xs text-muted-foreground">{t('bookingImport.mappingHint')}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {file.headers.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-40 truncate text-xs" title={h}>
                  {h || `(${i + 1})`}
                </span>
                <Select
                  value={mapping[i] ?? NONE}
                  onValueChange={(v) =>
                    setMapping((m) => {
                      const next = [...m]
                      // Et felt kan kun sidde på én kolonne.
                      if (v !== NONE) next.forEach((x, j) => { if (x === v && j !== i) next[j] = null })
                      next[i] = v === NONE ? null : (v as ImportField)
                      return next
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-52 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('bookingImport.ignoreColumn')}</SelectItem>
                    {IMPORT_FIELDS.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {t(`bookingImport.field.${f.key}`)}{f.required ? ' *' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          {(missingRequired.length > 0 || !hasTime) && (
            <p className="text-xs text-status-neutral-to-bad">
              {!hasTime
                ? t('bookingImport.needTime')
                : t('bookingImport.needFields', { fields: missingRequired.map((k) => t(`bookingImport.field.${k}`)).join(', ') })}
            </p>
          )}
          {file.rows[0] && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left">
                  <tr>{file.headers.map((h, i) => <th key={i} className="px-2 py-1 font-normal text-muted-foreground">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {file.rows.slice(0, 3).map((r, ri) => (
                    <tr key={ri} className="border-t">{r.map((c, ci) => <td key={ci} className="px-2 py-1 whitespace-nowrap">{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!ready || busy} onClick={() => void run(false)}>
              <Search className="size-4" /> {t('bookingImport.dryRun')}
            </Button>
            <Label className="text-xs text-muted-foreground">{t('bookingImport.dryRunHint')}</Label>
          </div>
        </div>
      )}

      {/* 3) Resultatet — tørkørsel eller kvittering */}
      {shown && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] font-[450]">
              {receipt ? t('bookingImport.receiptTitle') : t('bookingImport.dryRunTitle')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('bookingImport.summary', { rows: shown.rows, created: shown.created, updated: shown.updated, unchanged: shown.unchanged, skipped: shown.skipped })}
            </span>
            {!receipt && (
              <Button size="sm" disabled={busy || shown.created + shown.updated === 0} onClick={() => void run(true)}>
                <Play className="size-4" /> {t('bookingImport.apply')}
              </Button>
            )}
            {receipt && (
              <Link to="/booking/report" className="text-xs underline">{t('bookingImport.goToReport')}</Link>
            )}
          </div>
          {!shown.results.some((r) => r.external_ref) && (
            <p className="text-xs text-status-neutral-to-bad">{t('bookingImport.noRefWarning')}</p>
          )}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-2 py-1 font-normal text-muted-foreground">#</th>
                  <th className="px-2 py-1 font-normal text-muted-foreground">{t('bookingImport.col.action')}</th>
                  <th className="px-2 py-1 font-normal text-muted-foreground">{t('bookingImport.field.external_ref')}</th>
                  <th className="px-2 py-1 font-normal text-muted-foreground">{t('bookingFlow.resource')}</th>
                  <th className="px-2 py-1 font-normal text-muted-foreground">{t('bookingFlow.employee')}</th>
                  <th className="px-2 py-1 font-normal text-muted-foreground">{t('bookingPage.when')}</th>
                  <th className="px-2 py-1 font-normal text-muted-foreground">{t('bookingImport.col.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.results.map((r) => (
                  <tr key={r.row} className="border-t">
                    <td className="px-2 py-1 text-muted-foreground">{r.row}</td>
                    <td className="px-2 py-1">
                      <Badge variant="secondary" className={cn(ACTION_TONE[r.action])}>{t(`bookingImport.action.${r.action}`)}</Badge>
                    </td>
                    <td className="px-2 py-1 font-mono">{r.external_ref ?? '—'}</td>
                    <td className="px-2 py-1">{r.resource ?? '—'}</td>
                    <td className="px-2 py-1">{r.employee ?? '—'}</td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {r.starts_at ? `${fmt(r.starts_at)} – ${r.ends_at ? fmt(r.ends_at) : ''}` : '—'}
                    </td>
                    <td className="px-2 py-1 text-status-neutral-to-bad">{r.reason ? t(`bookingImport.reason.${r.reason}`, r.reason) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5) Loggen */}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-[450]">{t('bookingImport.runsTitle')}</span>
        {!runs || runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('bookingImport.runsEmpty')}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-2 py-1 font-normal text-muted-foreground">{t('bookingImport.runWhen')}</th>
                  <th className="px-2 py-1 font-normal text-muted-foreground">{t('bookingImport.runFile')}</th>
                  <th className="px-2 py-1 font-normal text-muted-foreground">{t('bookingImport.runBy')}</th>
                  <th className="px-2 py-1 font-normal text-muted-foreground">{t('bookingImport.runStatus')}</th>
                  <th className="px-2 py-1 font-normal text-muted-foreground">{t('bookingImport.runCounts')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-1 whitespace-nowrap">{fmt(r.created_at)}</td>
                    <td className="px-2 py-1">{r.file_name ?? '—'}</td>
                    <td className="px-2 py-1">{r.created_by_email ?? '—'}</td>
                    <td className="px-2 py-1">
                      <Badge variant="secondary" className={cn(r.status === 'applied' ? ACTION_TONE.create : ACTION_TONE.skip)}>
                        {r.status === 'applied' ? t('importPage.statusApplied') : t('importPage.statusRejected')}
                      </Badge>
                    </td>
                    <td className="px-2 py-1 tabular-nums">
                      {r.created_count} / {r.updated_count} / {r.unchanged_count} / {r.rejected_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

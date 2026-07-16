import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { FileUp, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable } from '@/components/data-table'
import { useAccess } from '@/hooks/use-access'
import { useImportConfig } from '@/hooks/use-import-config'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useSession } from '@/hooks/use-session'
import {
  coerceValue,
  moduleFieldMap,
  normalizeHeader,
  sameValue,
  type ModuleSpec,
} from '@/lib/module-import'
import { fetchAllPages, stripFooter } from '@/lib/import-utils'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Aktiv-/lagerimport (Lokale filer) i tre trin — upload → validér/forhåndsvis
// (tørkørsel, intet skrives) → anvend. Semantik som medarbejderimporten:
//  - upsert på nøglefeltet (aktiv-nr./varenr.) inden for virksomheden
//  - rækker der mangler i filen deaktiveres (aldrig slettes)
//  - kategorier/placeringer oprettes automatisk ud fra navnekolonnerne
//  - defekt fil ⇒ afvist, intet anvendes, og kørslen logges (import_runs)

type Cells = Record<string, string | number | null>
type CsvRow = { rowNumber: number; keyValue: string; name: string; cells: Cells }
type RowError = { row: number; reason: string }

type ExistingRow = {
  id: string
  name: string
  category_id: string | null
  location_id: string | null
  is_active: boolean
  [column: string]: unknown
}

type Diff = {
  fileName: string
  fields: string[] // aktive felter der faktisk findes i filen — kun de skrives
  rows: CsvRow[]
  errors: RowError[]
  creates: CsvRow[]
  updates: { row: CsvRow; existingId: string }[]
  unchanged: number
  deactivations: { id: string; name: string }[]
  newCategories: string[]
  newLocations: string[]
}

type Receipt = {
  ok: boolean
  created: number
  updated: number
  deactivated: number
  refs: number
  rejected: number
}

const CAT_COLUMN = 'category_id'
const LOC_COLUMN = 'location_id'
const NEW = 'NEW' // sentinel: kategori/placering der først oprettes ved "anvend"

export function ModuleImportLocal({ spec }: { spec: ModuleSpec }) {
  const { t } = useTranslation()
  const { session } = useSession()
  const { data: access } = useAccess()
  const { companyId } = useCompanyContext()
  const { data: savedCfg, isPending: cfgPending } = useImportConfig(companyId, spec.importType)
  const queryClient = useQueryClient()

  const fieldMap = moduleFieldMap(spec)
  const zeroDefaults = new Set(spec.zeroDefaultFields)
  // Konfigurationen er kontrakten — også uden en gemt række (så gælder
  // modulets standarder, som konfigurationssiden viser).
  const cfg = {
    hasHeader: savedCfg?.has_header ?? true,
    hasFooter: savedCfg?.has_footer ?? false,
    separator: savedCfg?.separator ?? ',',
    fields: savedCfg?.fields ?? spec.defaultFields,
  }
  const fieldLabel = (key: string) => t(`${spec.i18nKey}.field_${key}`)

  const [step, setStep] = useState<'upload' | 'preview' | 'receipt'>('upload')
  const [fileError, setFileError] = useState<string | null>(null)
  const [diff, setDiff] = useState<Diff | null>(null)
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const logRun = async (
    status: 'applied' | 'rejected' | 'failed',
    fileName: string,
    counts: Partial<Record<string, number>>,
    errors: RowError[],
  ) => {
    const { error } = await supabase.from('import_runs').insert({
      company_id: companyId!,
      kind: spec.runKind,
      file_name: fileName,
      status,
      rows_total: counts.rows_total ?? 0,
      created_count: counts.created ?? 0,
      updated_count: counts.updated ?? 0,
      unchanged_count: counts.unchanged ?? 0,
      deactivated_count: counts.deactivated ?? 0,
      rejected_count: errors.length,
      errors: errors as unknown as import('@/lib/database.types').Json,
      created_by: session?.user.id ?? null,
      created_by_email: session?.user.email ?? null,
    })
    if (error) console.error('Kunne ikke logge importkørsel:', error)
    queryClient.invalidateQueries({ queryKey: ['import-runs'] })
  }

  // Byg de kolonner importen styrer for en række — kun de aktive felter der
  // findes i filen, så en delvis fil aldrig nulstiller kolonner den ikke bærer.
  // resolveRef mapper kategori-/placeringsnavn → id (eller NEW-sentinel).
  const buildColumns = (
    row: CsvRow,
    resolveRef: (kind: 'category' | 'location', name: string) => string | null,
    fields: string[],
  ) => {
    const cols: Record<string, unknown> = {}
    for (const key of fields) {
      const f = fieldMap[key]
      if (!f) continue
      const cell = row.cells[key]
      if (f.kind === 'category') {
        cols[CAT_COLUMN] = cell ? resolveRef('category', String(cell)) : null
      } else if (f.kind === 'location') {
        cols[LOC_COLUMN] = cell ? resolveRef('location', String(cell)) : null
      } else if (f.kind === 'number' && cell === null && zeroDefaults.has(key)) {
        cols[key] = 0
      } else {
        cols[key] = cell
      }
    }
    return cols
  }

  // ── Trin 1: upload + parse + validering + tørkørsels-diff ────────────────
  const handleFile = async (file: File) => {
    if (!companyId || cfgPending) return
    setFileError(null)
    try {
      let text = await file.text() // afkodes som UTF-8
      if (text.includes('�')) {
        setFileError(t('importPage.encodingError'))
        await logRun('rejected', file.name, {}, [{ row: 0, reason: t('importPage.encodingError') }])
        return
      }
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // BOM
      // Footeren strippes FØR parsning (se stripFooter) — et slice(0, -1) på de
      // parsede rækker ville fjerne en rigtig datarække når footeren er tom.
      if (cfg.hasFooter) text = stripFooter(text)

      // rå records: field-nøgle → strengværdi (før typekonvertering)
      let records: Record<string, string | undefined>[] = []
      let firstDataRow: number
      // Positionelt bærer filen pr. kontrakt alle aktive felter; med header
      // indsnævres til de kolonner der faktisk blev fundet via aliaser.
      let presentFields = cfg.fields

      const detectSeparatorMismatch = (columnsFound: number): string | null => {
        if (columnsFound > 1 || cfg.fields.length <= 1) return null
        const sniff = Papa.parse<string[]>(text, { skipEmptyLines: true, preview: 5 })
        const detected = sniff.meta.delimiter
        if (detected && detected !== cfg.separator && (sniff.data[0]?.length ?? 0) > 1)
          return detected
        return null
      }
      const separatorName = (sep: string) => (sep === '\t' ? t('importPage.tabSeparator') : sep)

      if (!cfg.hasHeader) {
        // Positionel: kolonnerne mappes efter den konfigurerede rækkefølge.
        const parsed = Papa.parse<string[]>(text, { delimiter: cfg.separator, skipEmptyLines: true })
        if (parsed.errors.some((e) => e.type === 'Delimiter')) {
          setFileError(t('importPage.parseError'))
          return
        }
        const mismatch = detectSeparatorMismatch(parsed.data[0]?.length ?? 0)
        if (mismatch) {
          const message = t('importPage.separatorMismatch', {
            sep: cfg.separator,
            found: separatorName(mismatch),
          })
          setFileError(message)
          await logRun('rejected', file.name, { rows_total: parsed.data.length }, [{ row: 0, reason: message }])
          return
        }
        firstDataRow = 1
        records = parsed.data.map((cols) => {
          const rec: Record<string, string | undefined> = {}
          cfg.fields.forEach((key, i) => {
            rec[key] = cols[i]
          })
          return rec
        })
      } else {
        // Headerrække: kolonner findes via aliaser; kun aktive felter læses.
        const parsed = Papa.parse<Record<string, string>>(text, {
          header: true,
          delimiter: cfg.separator,
          skipEmptyLines: true,
          transformHeader: normalizeHeader,
        })
        if (parsed.errors.some((e) => e.type === 'Delimiter')) {
          setFileError(t('importPage.parseError'))
          return
        }
        const headers = parsed.meta.fields ?? []
        const mismatch = detectSeparatorMismatch(headers.length)
        if (mismatch) {
          const message = t('importPage.separatorMismatch', {
            sep: cfg.separator,
            found: separatorName(mismatch),
          })
          setFileError(message)
          await logRun('rejected', file.name, { rows_total: parsed.data.length }, [{ row: 0, reason: message }])
          return
        }
        // aktivt felt → fundet headernavn (via aliaser)
        const columnFor: Record<string, string> = {}
        for (const key of cfg.fields) {
          const f = fieldMap[key]
          if (!f) continue
          const hit = headers.find((h) => f.aliases.includes(h))
          if (hit) columnFor[key] = hit
        }
        const missing = [
          ...(!columnFor[spec.keyField] ? [t(`${spec.i18nKey}.colKey`)] : []),
          ...(!columnFor.name ? [t('moduleImport.common.colName')] : []),
        ]
        if (missing.length) {
          const message = t('importPage.missingColumns', { cols: missing.join(', ') })
          setFileError(message)
          await logRun('rejected', file.name, { rows_total: parsed.data.length }, [{ row: 0, reason: message }])
          return
        }
        presentFields = cfg.fields.filter((key) => columnFor[key])
        firstDataRow = 2
        records = parsed.data.map((raw) => {
          const rec: Record<string, string | undefined> = {}
          for (const [key, col] of Object.entries(columnFor)) rec[key] = raw[col]
          return rec
        })
      }

      if (records.length === 0) {
        setFileError(t('importPage.emptyFile'))
        return
      }

      // rækkevalidering + typekonvertering (fælles for begge tilstande)
      const rows: CsvRow[] = []
      const errors: RowError[] = []
      const seen = new Map<string, number>()
      records.forEach((rec, i) => {
        const rowNumber = i + firstDataRow
        const keyRaw = String(rec[spec.keyField] ?? '').trim()
        const name = String(rec.name ?? '').trim()
        if (!keyRaw) {
          errors.push({ row: rowNumber, reason: t(`${spec.i18nKey}.reasonMissingKey`) })
          return
        }
        if (!name) {
          errors.push({ row: rowNumber, reason: t('importPage.reasonMissingName') })
          return
        }
        if (seen.has(keyRaw)) {
          errors.push({ row: rowNumber, reason: t(`${spec.i18nKey}.reasonDuplicate`) })
          return
        }
        // konvertér de aktive felter til deres typer
        const cells: Cells = {}
        let cellError: string | null = null
        for (const key of presentFields) {
          const f = fieldMap[key]
          if (!f) continue
          const coerced = coerceValue(f.kind, rec[key])
          if (!coerced.ok) {
            const reasonKey =
              f.kind === 'date' ? 'moduleImport.common.reasonInvalidDate' : 'moduleImport.common.reasonInvalidNumber'
            cellError = t(reasonKey, { field: fieldLabel(key) })
            break
          }
          cells[key] = coerced.value
        }
        if (cellError) {
          errors.push({ row: rowNumber, reason: cellError })
          return
        }
        seen.set(keyRaw, rowNumber)
        rows.push({ rowNumber, keyValue: keyRaw, name, cells })
      })

      // tørkørsel mod databasen (sidevis — se fetchAllPages)
      const [existing, categories, locations] = await Promise.all([
        fetchAllPages((from, to) =>
          supabase.from(spec.table).select(spec.selectColumns).eq('company_id', companyId).order('id').range(from, to),
        ),
        fetchAllPages((from, to) =>
          supabase.from('asset_categories').select('id, name').eq('company_id', companyId).order('id').range(from, to),
        ),
        fetchAllPages((from, to) =>
          supabase.from('asset_locations').select('id, name').eq('company_id', companyId).order('id').range(from, to),
        ),
      ])

      const existingRows = existing as unknown as ExistingRow[]
      const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]))
      const locByName = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]))
      const byKey = new Map(
        existingRows
          .filter((e) => e[spec.keyField] != null)
          .map((e) => [String(e[spec.keyField]), e]),
      )

      const newCategories = new Set<string>()
      const newLocations = new Set<string>()
      // resolver til tørkørslen: eksisterende id, ellers NEW-sentinel
      const resolveRef = (kind: 'category' | 'location', rawName: string) => {
        const map = kind === 'category' ? catByName : locByName
        const set = kind === 'category' ? newCategories : newLocations
        const id = map.get(rawName.toLowerCase())
        if (id) return id
        set.add(rawName)
        return NEW
      }

      const creates: CsvRow[] = []
      const updates: { row: CsvRow; existingId: string }[] = []
      let unchanged = 0

      for (const row of rows) {
        const desired = buildColumns(row, resolveRef, presentFields)
        const current = byKey.get(row.keyValue)
        if (!current) {
          creates.push(row)
          continue
        }
        const changed =
          !current.is_active ||
          Object.entries(desired).some(([col, value]) => !sameValue(current[col], value))
        if (changed) updates.push({ row, existingId: current.id })
        else unchanged++
      }

      const fileKeys = new Set(rows.map((r) => r.keyValue))
      const deactivations = existingRows
        .filter((e) => e.is_active && e[spec.keyField] != null && !fileKeys.has(String(e[spec.keyField])))
        .map((e) => ({ id: e.id, name: e.name }))

      setDiff({
        fileName: file.name,
        fields: presentFields,
        rows,
        errors,
        creates,
        updates,
        unchanged,
        deactivations,
        newCategories: [...newCategories],
        newLocations: [...newLocations],
      })
      setStep('preview')
    } catch (error) {
      console.error('Import-parsing fejlede:', error)
      setFileError(t('importPage.parseError'))
    }
  }

  // ── Trin 3: anvend ────────────────────────────────────────────────────────
  const apply = async () => {
    if (!diff || !companyId) return
    setBusy(true)
    // Samme lås som den automatiske import-runner (og medarbejderimporten):
    // to samtidige anvend-kørsler ville race deres read-then-write-diff.
    const { data: locked, error: lockError } = await supabase.rpc('try_import_lock_self', {
      p_company_id: companyId,
    })
    if (lockError || locked !== true) {
      if (lockError) console.error('try_import_lock_self fejlede:', lockError)
      toast.error(t('importPage.applyBusy'))
      setBusy(false)
      return
    }
    const counts = {
      rows_total: diff.rows.length + diff.errors.length,
      created: 0,
      updated: 0,
      unchanged: diff.unchanged,
      deactivated: 0,
    }
    try {
      // 1) nye kategorier + placeringer → id-opslag (sidevis — se fetchAllPages)
      const catId = new Map<string, string>()
      const locId = new Map<string, string>()
      const existingCats = await fetchAllPages((from, to) =>
        supabase.from('asset_categories').select('id, name').eq('company_id', companyId).order('id').range(from, to),
      )
      existingCats.forEach((c) => catId.set(c.name.toLowerCase(), c.id))
      const existingLocs = await fetchAllPages((from, to) =>
        supabase.from('asset_locations').select('id, name').eq('company_id', companyId).order('id').range(from, to),
      )
      existingLocs.forEach((l) => locId.set(l.name.toLowerCase(), l.id))

      if (diff.newCategories.length) {
        const { data: created, error } = await supabase
          .from('asset_categories')
          .insert(diff.newCategories.map((name) => ({ company_id: companyId, name, track: spec.categoryTrack })))
          .select('id, name')
        if (error) throw error
        if (created.length !== diff.newCategories.length) throw new Error('RLS afviste kategorier')
        created.forEach((c) => catId.set(c.name.toLowerCase(), c.id))
      }
      if (diff.newLocations.length) {
        const { data: created, error } = await supabase
          .from('asset_locations')
          .insert(diff.newLocations.map((name) => ({ company_id: companyId, name })))
          .select('id, name')
        if (error) throw error
        if (created.length !== diff.newLocations.length) throw new Error('RLS afviste placeringer')
        created.forEach((l) => locId.set(l.name.toLowerCase(), l.id))
      }

      const resolveRef = (kind: 'category' | 'location', rawName: string) =>
        (kind === 'category' ? catId : locId).get(rawName.toLowerCase()) ?? null

      const payload = (row: CsvRow) => ({
        company_id: companyId,
        [spec.keyField]: row.keyValue,
        name: row.name,
        ...buildColumns(row, resolveRef, diff.fields),
        is_active: true,
      })

      // 2) nye rækker (i bidder af 500)
      for (let i = 0; i < diff.creates.length; i += 500) {
        const chunk = diff.creates.slice(i, i + 500)
        const { data, error } = await supabase
          .from(spec.table)
          .insert(chunk.map(payload) as never)
          .select('id')
        if (error) throw error
        if ((data?.length ?? 0) !== chunk.length) throw new Error('RLS afviste oprettelser')
        counts.created += data!.length
      }

      // 3) opdateringer (upsert på id)
      for (let i = 0; i < diff.updates.length; i += 500) {
        const chunk = diff.updates.slice(i, i + 500)
        const { data, error } = await supabase
          .from(spec.table)
          .upsert(chunk.map((u) => ({ id: u.existingId, ...payload(u.row) })) as never)
          .select('id')
        if (error) throw error
        if ((data?.length ?? 0) !== chunk.length) throw new Error('RLS afviste opdateringer')
        counts.updated += data!.length
      }

      // 4) deaktiveringer
      if (diff.deactivations.length) {
        const { data, error } = await supabase
          .from(spec.table)
          .update({ is_active: false } as never)
          .in('id', diff.deactivations.map((d) => d.id))
          .select('id')
        if (error) throw error
        if ((data?.length ?? 0) !== diff.deactivations.length) throw new Error('RLS afviste deaktivering')
        counts.deactivated = data!.length
      }

      await logRun('applied', diff.fileName, counts, diff.errors)
      queryClient.invalidateQueries({ queryKey: [spec.table] })
      queryClient.invalidateQueries({ queryKey: ['asset-categories'] })
      queryClient.invalidateQueries({ queryKey: ['asset-locations'] })
      setReceipt({
        ok: true,
        created: counts.created,
        updated: counts.updated,
        deactivated: counts.deactivated,
        refs: diff.newCategories.length + diff.newLocations.length,
        rejected: diff.errors.length,
      })
      setStep('receipt')
    } catch (error) {
      console.error('Import fejlede:', error)
      await logRun('failed', diff.fileName, counts, diff.errors)
      setReceipt({
        ok: false,
        created: counts.created,
        updated: counts.updated,
        deactivated: counts.deactivated,
        refs: 0,
        rejected: diff.errors.length,
      })
      setStep('receipt')
      toast.error(describeError(error, t))
    } finally {
      const { error: unlockError } = await supabase.rpc('release_import_lock_self', {
        p_company_id: companyId,
      })
      if (unlockError) console.error('release_import_lock_self fejlede:', unlockError)
      setBusy(false)
    }
  }

  const resetWizard = () => {
    setStep('upload')
    setDiff(null)
    setReceipt(null)
    setFileError(null)
  }

  if (access && !access.isManager && !access.isPlatformAdmin) {
    return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  }
  if (!companyId) return <Skeleton className="h-40 w-full" />

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-6">
      <header>
        <div>
          <h1 className="text-2xl font-medium text-foreground">{t(`${spec.i18nKey}.title`)}</h1>
          <p className="mt-1 max-w-xl text-sm text-foreground-light">{t(`${spec.i18nKey}.subtitle`)}</p>
        </div>
      </header>

      {/* Trinindikator */}
      <ol className="flex gap-6 text-[13px] font-[450]">
        {(['step1', 'step2', 'step3'] as const).map((key, i) => {
          const current = { upload: 0, preview: 1, receipt: 2 }[step]
          return (
            <li
              key={key}
              className={cn(
                'border-b-2 pb-1',
                i === current ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground',
              )}
            >
              {t(`importPage.${key}`)}
            </li>
          )
        })}
      </ol>

      {step === 'upload' && (
        <Card className="bg-panel">
          <CardContent className="flex flex-col gap-4 pt-6">
            <button
              type="button"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground-light"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const file = e.dataTransfer.files?.[0]
                if (file) handleFile(file)
              }}
            >
              <FileUp className="size-6" />
              <span className="text-[13px]">{t('importPage.dropHint')}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFile(file)
                e.target.value = ''
              }}
            />
            {fileError && <p className="text-sm text-destructive">{fileError}</p>}
          </CardContent>
        </Card>
      )}

      {step === 'preview' && diff && (
        <div className="flex flex-col gap-4">
          <Card className="bg-panel">
            <CardHeader>
              <CardTitle className="text-base">{t('importPage.previewTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[13px] sm:grid-cols-3">
                {(
                  [
                    [t(`${spec.i18nKey}.diffCreates`), diff.creates.length, false],
                    [t('importPage.diffUpdates'), diff.updates.length, false],
                    [t('importPage.diffUnchanged'), diff.unchanged, false],
                    [t('importPage.diffDeactivations'), diff.deactivations.length, false],
                    [t('moduleImport.common.diffNewCategories'), diff.newCategories.length, false],
                    [t('moduleImport.common.diffNewLocations'), diff.newLocations.length, false],
                    [t('importPage.diffRejected'), diff.errors.length, true],
                  ] as const
                ).map(([label, value, isRejected]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2 border-b border-border/50 py-1">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className={cn('font-medium', value > 0 && isRejected && 'text-status-neutral-to-bad')}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {diff.deactivations.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t('importPage.diffDeactivations')}:{' '}
                  {diff.deactivations.slice(0, 8).map((d) => d.name).join(', ')}
                  {diff.deactivations.length > 8 && ` … (+${diff.deactivations.length - 8})`}
                </p>
              )}
            </CardContent>
          </Card>

          {diff.errors.length > 0 && (
            <Card className="bg-panel">
              <CardHeader>
                <CardTitle className="text-base text-status-neutral-to-bad">
                  {t('importPage.rejectedRows')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  rows={diff.errors.map((e) => ({ id: `${diff.fileName}:${e.row}`, row: e.row, reason: e.reason }))}
                  columns={[
                    {
                      key: 'row',
                      header: t('importPage.rowNumber'),
                      sortable: true,
                      sortValue: (r) => r.row,
                      className: 'w-20',
                    },
                    {
                      key: 'reason',
                      header: t('importPage.reason'),
                      sortable: true,
                      sortValue: (r) => r.reason,
                      render: (r) => <span className="text-muted-foreground">{r.reason}</span>,
                    },
                  ]}
                  entityLabel={t('importPage.rejectedRows').toLowerCase()}
                  searchText={(r) => `${r.row} ${r.reason}`}
                  storageKey={`import-rejected-${spec.module}`}
                />
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={resetWizard} disabled={busy}>
              {t('importPage.backButton')}
            </Button>
            <Button onClick={apply} disabled={busy}>
              <Upload className="size-4" />
              {busy ? t('importPage.applying') : t('importPage.applyButton')}
            </Button>
          </div>
        </div>
      )}

      {step === 'receipt' && receipt && (
        <Card className="bg-panel">
          <CardHeader>
            <CardTitle className={cn('text-base', !receipt.ok && 'text-destructive')}>
              {receipt.ok ? t('importPage.receiptTitle') : t('importPage.receiptFailed')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm">
              {t('importPage.resultSummary', {
                created: receipt.created,
                updated: receipt.updated,
                deactivated: receipt.deactivated,
                rejected: receipt.rejected,
              })}
              {receipt.refs > 0 && ` · ${receipt.refs} ${t('moduleImport.common.refsCreated')}`}
            </p>
            <div>
              <Button variant="outline" size="sm" onClick={resetWizard}>
                {t('importPage.newImport')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

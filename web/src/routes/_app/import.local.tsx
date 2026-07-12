import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { FileUp, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable } from '@/components/data-table'
import { useAccess } from '@/hooks/use-access'
import { IMPORT_CONFIG_DEFAULTS, useImportConfig } from '@/hooks/use-import-config'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useSession } from '@/hooks/use-session'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/import/local')({
  component: ImportPage,
})

// Flow 0 (pilot): CSV-import af medarbejdere + afdelinger i tre trin —
// upload → validér/forhåndsvis (tørkørsel, intet skrives) → anvend.
// Semantik (se CLAUDE.md "Master data policy"):
//  - upsert på medarbejder_nr inden for virksomheden
//  - medarbejdere der mangler i filen deaktiveres (aldrig slettes)
//  - manuelt oprettede (is_manual) røres ikke
//  - afdelinger oprettes automatisk ud fra afdelingskolonnen
//  - defekt fil ⇒ afvist, intet anvendes, og kørslen logges (import_runs)

const HEADER_ALIASES: Record<string, string[]> = {
  employee_no: ['medarbejder_nr', 'medarbejdernr', 'medarbejdernummer', 'employee_no', 'employee_number'],
  full_name: ['navn', 'fulde_navn', 'name', 'full_name'],
  first_name: ['fornavn', 'first_name'],
  last_name: ['efternavn', 'last_name'],
  initials: ['initialer', 'initials'],
  email: ['email', 'e_mail', 'mail'],
  phone: ['telefon', 'phone', 'tlf', 'mobil'],
  department: ['afdeling', 'department'],
  language: ['sprog', 'language'],
  nfc_card_id: ['nfc_kort_id', 'nfc_card_id', 'nfc_uid', 'nfc'],
  role: ['rolle', 'role'],
}

// Mellemform efter parsning, uanset om filen har headere (alias-opslag)
// eller er positionel (konfigureret feltrækkefølge).
type RawRecord = Partial<
  Record<
    | 'employee_no'
    | 'full_name'
    | 'first_name'
    | 'last_name'
    | 'initials'
    | 'email'
    | 'phone'
    | 'department'
    | 'language'
    | 'nfc_card_id'
    | 'role',
    string
  >
>

type CsvRow = {
  rowNumber: number
  employee_no: string
  full_name: string
  first_name: string | null
  last_name: string | null
  initials: string | null
  email: string | null
  phone: string | null
  department: string | null
  language: string | null
  nfc_card_id: string | null
  role: string | null
}

type RowError = { row: number; reason: string }

type Diff = {
  fileName: string
  rows: CsvRow[]
  errors: RowError[]
  creates: CsvRow[]
  updates: { row: CsvRow; existingId: string }[]
  unchanged: number
  skippedManual: number
  deactivations: { id: string; name: string }[]
  newDepartments: string[]
}

type Receipt = {
  ok: boolean
  created: number
  updated: number
  deactivated: number
  departments: number
  rejected: number
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, '_')
    .replace(/_+$/, '')
}

function clean(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

function ImportPage() {
  const { t } = useTranslation()
  const { session } = useSession()
  const { data: access } = useAccess()
  const { companyId } = useCompanyContext()
  const { data: importCfg, isPending: cfgPending } = useImportConfig(companyId)
  const queryClient = useQueryClient()
  // Konfigurationen er kontrakten — også når der ikke er gemt en række
  // endnu (så gælder standarderne, som konfigurationssiden viser).
  const saved = importCfg ?? IMPORT_CONFIG_DEFAULTS
  const cfg = {
    hasHeader: saved.has_header,
    hasFooter: saved.has_footer,
    separator: saved.separator,
    fields: saved.fields,
  }

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
      file_name: fileName,
      status,
      rows_total: counts.rows_total ?? 0,
      created_count: counts.created ?? 0,
      updated_count: counts.updated ?? 0,
      unchanged_count: counts.unchanged ?? 0,
      deactivated_count: counts.deactivated ?? 0,
      skipped_manual_count: counts.skippedManual ?? 0,
      departments_created: counts.departments ?? 0,
      rejected_count: errors.length,
      errors: errors as unknown as import('@/lib/database.types').Json,
      created_by: session?.user.id ?? null,
      created_by_email: session?.user.email ?? null,
    })
    if (error) console.error('Kunne ikke logge importkørsel:', error)
    queryClient.invalidateQueries({ queryKey: ['import-runs'] })
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

      // ── Parsning → RawRecord[] efter konfigurationen ──
      let records: RawRecord[] = []
      let firstDataRow: number // filens 1-indekserede række for første datarække

      // "Forkert separator" er langt mere sandsynlig end en ægte enkelt-
      // kolonnefil: hvis den konfigurerede separator kun giver én kolonne,
      // spørger vi Papa hvad filen selv ligner, og melder separatorfejl.
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
        const parsed = Papa.parse<string[]>(text, {
          delimiter: cfg.separator,
          skipEmptyLines: true,
        })
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
          await logRun('rejected', file.name, { rows_total: parsed.data.length }, [
            { row: 0, reason: message },
          ])
          return
        }
        let dataRows = parsed.data
        if (cfg.hasFooter && dataRows.length) dataRows = dataRows.slice(0, -1)
        firstDataRow = 1
        records = dataRows.map((cols) => {
          const rec: RawRecord = {}
          cfg.fields.forEach((key, i) => {
            const mapped = key === 'name' ? 'full_name' : (key as keyof RawRecord)
            rec[mapped] = cols[i]
          })
          return rec
        })
      } else {
        // Headerrække: kolonner findes via aliaser med den konfigurerede
        // separator, og kun de aktive felter importeres.
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

        // Aktive felter begrænser hvad der importeres; 'name' dækker også
        // fornavn/efternavn-varianten.
        const activeFields = new Set(
          cfg.fields
            .map((k) => (k === 'name' ? 'full_name' : k))
            .concat(cfg.fields.includes('name') ? ['first_name', 'last_name'] : []),
        )

        const headers = parsed.meta.fields ?? []
        const mismatch = detectSeparatorMismatch(headers.length)
        if (mismatch) {
          const message = t('importPage.separatorMismatch', {
            sep: cfg.separator,
            found: separatorName(mismatch),
          })
          setFileError(message)
          await logRun('rejected', file.name, { rows_total: parsed.data.length }, [
            { row: 0, reason: message },
          ])
          return
        }
        const fieldFor: Record<string, string> = {}
        for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
          if (!activeFields.has(field)) continue
          const hit = headers.find((h) => aliases.includes(h))
          if (hit) fieldFor[field] = hit
        }
        // navn kan leveres som 'navn' ELLER som 'fornavn'+'efternavn'
        const hasNameColumns = !!fieldFor.full_name || (!!fieldFor.first_name && !!fieldFor.last_name)
        const missing = [
          ...(!fieldFor.employee_no ? [t('importPage.colEmployeeNo')] : []),
          ...(!hasNameColumns ? [t('importPage.colName')] : []),
        ]
        if (missing.length) {
          const message = t('importPage.missingColumns', { cols: missing.join(', ') })
          setFileError(message)
          await logRun('rejected', file.name, { rows_total: parsed.data.length }, [
            { row: 0, reason: message },
          ])
          return
        }
        let dataRows = parsed.data
        if (cfg.hasFooter && dataRows.length) dataRows = dataRows.slice(0, -1)
        firstDataRow = 2
        records = dataRows.map((raw) => {
          const rec: RawRecord = {}
          for (const [field, col] of Object.entries(fieldFor))
            rec[field as keyof RawRecord] = raw[col]
          return rec
        })
      }

      if (records.length === 0) {
        setFileError(t('importPage.emptyFile'))
        return
      }

      // rækkevalidering (fælles for begge tilstande)
      const rows: CsvRow[] = []
      const errors: RowError[] = []
      const seen = new Map<string, number>()
      records.forEach((rec, i) => {
        const rowNumber = i + firstDataRow
        const employee_no = clean(rec.employee_no)
        const first_name = clean(rec.first_name)
        const last_name = clean(rec.last_name)
        // 'navn' vinder; ellers afledes af fornavn + efternavn
        const full_name =
          clean(rec.full_name) ?? ([first_name, last_name].filter(Boolean).join(' ') || null)
        if (!employee_no) {
          errors.push({ row: rowNumber, reason: t('importPage.reasonMissingNo') })
          return
        }
        if (!full_name) {
          errors.push({ row: rowNumber, reason: t('importPage.reasonMissingName') })
          return
        }
        if (seen.has(employee_no)) {
          errors.push({ row: rowNumber, reason: t('importPage.reasonDuplicate') })
          return
        }
        seen.set(employee_no, rowNumber)
        rows.push({
          rowNumber,
          employee_no,
          full_name,
          first_name,
          last_name,
          initials: clean(rec.initials),
          email: clean(rec.email),
          phone: clean(rec.phone),
          department: clean(rec.department),
          language: clean(rec.language),
          nfc_card_id: clean(rec.nfc_card_id),
          role: clean(rec.role),
        })
      })

      // tørkørsel mod databasen
      const [employees, departments] = await Promise.all([
        supabase
          .from('employees')
          .select('id, employee_no, full_name, first_name, last_name, initials, email, phone, language, department_id, is_active, is_manual, nfc_card_id, role')
          .eq('company_id', companyId),
        supabase.from('departments').select('id, name').eq('company_id', companyId),
      ])
      if (employees.error) throw employees.error
      if (departments.error) throw departments.error

      const deptByName = new Map(departments.data.map((d) => [d.name.toLowerCase(), d]))
      const byNo = new Map(
        employees.data.filter((e) => e.employee_no).map((e) => [e.employee_no as string, e]),
      )

      const creates: CsvRow[] = []
      const updates: { row: CsvRow; existingId: string }[] = []
      let unchanged = 0
      let skippedManual = 0
      const newDepartments = new Set<string>()

      for (const row of rows) {
        if (row.department && !deptByName.has(row.department.toLowerCase())) {
          newDepartments.add(row.department)
        }
        const existing = byNo.get(row.employee_no)
        if (!existing) {
          creates.push(row)
          continue
        }
        if (existing.is_manual) {
          skippedManual++
          continue
        }
        const targetDept = row.department
          ? (deptByName.get(row.department.toLowerCase())?.id ?? 'NEW')
          : null
        const changed =
          existing.full_name !== row.full_name ||
          (existing.first_name ?? null) !== row.first_name ||
          (existing.last_name ?? null) !== row.last_name ||
          (existing.nfc_card_id ?? null) !== row.nfc_card_id ||
          (existing.role ?? null) !== row.role ||
          (existing.initials ?? null) !== row.initials ||
          (existing.email ?? null) !== row.email ||
          (existing.phone ?? null) !== row.phone ||
          (row.language !== null && existing.language !== row.language) ||
          (existing.department_id ?? null) !== (targetDept === 'NEW' ? 'NEW' : targetDept) ||
          !existing.is_active
        if (changed) updates.push({ row, existingId: existing.id })
        else unchanged++
      }

      const fileNos = new Set(rows.map((r) => r.employee_no))
      const deactivations = employees.data
        .filter((e) => !e.is_manual && e.is_active && e.employee_no && !fileNos.has(e.employee_no))
        .map((e) => ({ id: e.id, name: e.full_name }))

      setDiff({
        fileName: file.name,
        rows,
        errors,
        creates,
        updates,
        unchanged,
        skippedManual,
        deactivations,
        newDepartments: [...newDepartments],
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
    const counts = {
      rows_total: diff.rows.length + diff.errors.length,
      created: 0,
      updated: 0,
      unchanged: diff.unchanged,
      deactivated: 0,
      skippedManual: diff.skippedManual,
      departments: 0,
    }
    try {
      // 1) nye afdelinger
      const deptIdByName = new Map<string, string>()
      const { data: existingDepts, error: deptErr } = await supabase
        .from('departments')
        .select('id, name')
        .eq('company_id', companyId)
      if (deptErr) throw deptErr
      existingDepts.forEach((d) => deptIdByName.set(d.name.toLowerCase(), d.id))

      if (diff.newDepartments.length) {
        const { data: created, error } = await supabase
          .from('departments')
          .insert(diff.newDepartments.map((name) => ({ company_id: companyId, name })))
          .select('id, name')
        if (error) throw error
        if (created.length !== diff.newDepartments.length) throw new Error('RLS afviste afdelinger')
        created.forEach((d) => deptIdByName.set(d.name.toLowerCase(), d.id))
        counts.departments = created.length
      }

      const mapRow = (row: CsvRow) => ({
        company_id: companyId,
        employee_no: row.employee_no,
        full_name: row.full_name,
        first_name: row.first_name,
        last_name: row.last_name,
        nfc_card_id: row.nfc_card_id,
        role: row.role,
        initials: row.initials,
        email: row.email,
        phone: row.phone,
        language: row.language ?? 'da',
        department_id: row.department
          ? (deptIdByName.get(row.department.toLowerCase()) ?? null)
          : null,
        is_active: true,
        is_manual: false,
      })

      // 2) nye medarbejdere (i bidder af 500)
      for (let i = 0; i < diff.creates.length; i += 500) {
        const chunk = diff.creates.slice(i, i + 500)
        const { data, error } = await supabase
          .from('employees')
          .insert(chunk.map(mapRow))
          .select('id')
        if (error) throw error
        if (data.length !== chunk.length) throw new Error('RLS afviste oprettelser')
        counts.created += data.length
      }

      // 3) opdateringer (upsert på id)
      for (let i = 0; i < diff.updates.length; i += 500) {
        const chunk = diff.updates.slice(i, i + 500)
        const { data, error } = await supabase
          .from('employees')
          .upsert(chunk.map((u) => ({ id: u.existingId, ...mapRow(u.row) })))
          .select('id')
        if (error) throw error
        if (data.length !== chunk.length) throw new Error('RLS afviste opdateringer')
        counts.updated += data.length
      }

      // 4) deaktiveringer
      if (diff.deactivations.length) {
        const { data, error } = await supabase
          .from('employees')
          .update({ is_active: false })
          .in('id', diff.deactivations.map((d) => d.id))
          .select('id')
        if (error) throw error
        if (data.length !== diff.deactivations.length) throw new Error('RLS afviste deaktivering')
        counts.deactivated = data.length
      }

      await logRun('applied', diff.fileName, counts, diff.errors)
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      queryClient.invalidateQueries({ queryKey: ['departments-list'] })
      setReceipt({
        ok: true,
        created: counts.created,
        updated: counts.updated,
        deactivated: counts.deactivated,
        departments: counts.departments,
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
        departments: counts.departments,
        rejected: diff.errors.length,
      })
      setStep('receipt')
      toast.error(t('common.error'))
    } finally {
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
          <h1 className="text-2xl font-medium text-foreground">{t('importPage.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-foreground-light">
            {t('importPage.subtitle')}
          </p>
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
                    ['diffCreates', diff.creates.length],
                    ['diffUpdates', diff.updates.length],
                    ['diffUnchanged', diff.unchanged],
                    ['diffDeactivations', diff.deactivations.length],
                    ['diffSkippedManual', diff.skippedManual],
                    ['diffNewDepartments', diff.newDepartments.length],
                    ['diffRejected', diff.errors.length],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key} className="flex items-baseline justify-between gap-2 border-b border-border/50 py-1">
                    <dt className="text-muted-foreground">{t(`importPage.${key}`)}</dt>
                    <dd className={cn('font-medium', value > 0 && key === 'diffRejected' && 'text-status-neutral-to-bad')}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {diff.newDepartments.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t('importPage.diffNewDepartments')}: {diff.newDepartments.join(', ')}
                </p>
              )}
              {diff.deactivations.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
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
                  rows={diff.errors.map((e) => ({
                    id: `${diff.fileName}:${e.row}`,
                    row: e.row,
                    reason: e.reason,
                  }))}
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
                  storageKey="import-rejected"
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
              {receipt.departments > 0 && ` · ${receipt.departments} ${t('importPage.diffNewDepartments').toLowerCase()}`}
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

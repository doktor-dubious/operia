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
  const queryClient = useQueryClient()

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
    if (!companyId) return
    setFileError(null)
    try {
      let text = await file.text() // afkodes som UTF-8
      if (text.includes('�')) {
        setFileError(t('importPage.encodingError'))
        await logRun('rejected', file.name, {}, [{ row: 0, reason: t('importPage.encodingError') }])
        return
      }
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // BOM

      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: normalizeHeader,
      })
      if (parsed.errors.some((e) => e.type === 'Delimiter')) {
        setFileError(t('importPage.parseError'))
        return
      }

      // map normaliserede headers -> feltnavne
      const headers = parsed.meta.fields ?? []
      const fieldFor: Record<string, string> = {}
      for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        const hit = headers.find((h) => aliases.includes(h))
        if (hit) fieldFor[field] = hit
      }
      // navn kan leveres som 'navn' ELLER som 'fornavn'+'efternavn'
      const hasNameColumns = !!fieldFor.full_name || (!!fieldFor.first_name && !!fieldFor.last_name)
      const missing = [
        ...(!fieldFor.employee_no ? ['medarbejder_nr'] : []),
        ...(!hasNameColumns ? ['navn (eller fornavn + efternavn)'] : []),
      ]
      if (missing.length) {
        setFileError(t('importPage.missingColumns', { cols: missing.join(', ') }))
        await logRun('rejected', file.name, { rows_total: parsed.data.length }, [
          { row: 0, reason: `Manglende kolonner: ${missing.join(', ')}` },
        ])
        return
      }
      if (parsed.data.length === 0) {
        setFileError(t('importPage.emptyFile'))
        return
      }

      // rækkevalidering
      const rows: CsvRow[] = []
      const errors: RowError[] = []
      const seen = new Map<string, number>()
      parsed.data.forEach((raw, i) => {
        const rowNumber = i + 2 // 1-indekseret + headerrække
        const employee_no = clean(raw[fieldFor.employee_no])
        const first_name = fieldFor.first_name ? clean(raw[fieldFor.first_name]) : null
        const last_name = fieldFor.last_name ? clean(raw[fieldFor.last_name]) : null
        // 'navn' vinder; ellers afledes af fornavn + efternavn
        const full_name =
          (fieldFor.full_name ? clean(raw[fieldFor.full_name]) : null) ??
          ([first_name, last_name].filter(Boolean).join(' ') || null)
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
          initials: fieldFor.initials ? clean(raw[fieldFor.initials]) : null,
          email: fieldFor.email ? clean(raw[fieldFor.email]) : null,
          phone: fieldFor.phone ? clean(raw[fieldFor.phone]) : null,
          department: fieldFor.department ? clean(raw[fieldFor.department]) : null,
          language: fieldFor.language ? clean(raw[fieldFor.language]) : null,
          nfc_card_id: fieldFor.nfc_card_id ? clean(raw[fieldFor.nfc_card_id]) : null,
          role: fieldFor.role ? clean(raw[fieldFor.role]) : null,
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
            <div className="text-xs text-muted-foreground">
              <p>{t('importPage.expectedColumns')}</p>
              <code className="mt-1 block rounded-md bg-muted p-2 font-mono">
                medarbejder_nr; navn (eller fornavn; efternavn); initialer; email; telefon; afdeling; sprog; nfc_kort_id; rolle
              </code>
              <p className="mt-1">{t('importPage.columnsRequired')}</p>
            </div>
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">{t('importPage.rowNumber')}</TableHead>
                      <TableHead>{t('importPage.reason')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diff.errors.slice(0, 20).map((e, i) => (
                      <TableRow key={i}>
                        <TableCell>{e.row}</TableCell>
                        <TableCell className="text-muted-foreground">{e.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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

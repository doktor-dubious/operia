// Server-side port af Flow 0-medarbejderimporten (jf. web/src/routes/_app/
// import.local.tsx). Samme kontrakt: konfigurations-styret parsning (header eller
// positionel), validering, tørkørsels-diff, beskyttelse af manuelt oprettede,
// deaktivering af rækker der mangler i filen, og auto-oprettelse af afdelinger.
// Kaldes af sftp-uploaded og email-inbound med en service-role-klient.
// Ren logik: al validering sker her; kalderen logger import_run + inbound_files.
//
// Filen ejer kun de felter den faktisk indeholder (matchede kolonner hhv. den
// konfigurerede feltrækkefølge). Felter uden kolonne i filen røres ALDRIG — så
// fx et NFC-kort tildelt i appen ikke slettes af en import uden NFC-kolonne.

import Papa from 'npm:papaparse@5.4.1'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

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

export const IMPORT_CONFIG_DEFAULTS: ImportConfig = {
  has_header: true,
  has_footer: false,
  separator: ',',
  fields: ['employee_no', 'name', 'initials', 'email', 'phone', 'department', 'language', 'nfc_card_id', 'role'],
}

export type ImportConfig = {
  has_header: boolean
  has_footer: boolean
  separator: string
  fields: string[]
}

export type ImportOptions = {
  // Ubemandet kørsel (SFTP/e-mail): afvis frem for at masse-deaktivere, hvis en
  // trunkeret-men-parsbar fil ville deaktivere en stor andel af medarbejderne.
  // Den manuelle /import-flade har et menneske i tørkørsels-previewet i stedet.
  guardDeactivations?: boolean
}

// Ubemandet værn: afvis når filen ville deaktivere mindst 5 medarbejdere OG
// over 20 % af de aktive, import-styrede medarbejdere.
const DEACTIVATION_GUARD_MIN = 5
const DEACTIVATION_GUARD_RATIO = 0.2

type RawRecord = Partial<Record<string, string>>
// Årsager gemmes SPROGUAFHÆNGIGT som koder (+ evt. parametre); klienten
// oversætter dem ved visning (web/src/lib/import-reasons.ts).
type RowError = { row: number; code: string; params?: Record<string, string> }

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

export type ImportResult = {
  status: 'applied' | 'rejected'
  fileError?: string // kode ved fil-niveau-afvisning (intet anvendt)
  counts: {
    rows_total: number
    created: number
    updated: number
    unchanged: number
    deactivated: number
    skippedManual: number
    departments: number
  }
  errors: RowError[] // række-niveau (sprunget over, resten anvendt)
}

// Fejler anvendelsen halvvejs (ikke-atomare chunks), bærer fejlen de tal der
// NÅEDE at blive anvendt, så den fejlede kørsel logges ærligt.
export type ImportApplyError = Error & { partialCounts?: ImportResult['counts'] }

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s.-]+/g, '_').replace(/_+$/, '')
}

function clean(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

function reject(code: string, rowsTotal = 0, params?: Record<string, string>): ImportResult {
  return {
    status: 'rejected',
    fileError: code,
    counts: { rows_total: rowsTotal, created: 0, updated: 0, unchanged: 0, deactivated: 0, skippedManual: 0, departments: 0 },
    errors: [{ row: 0, code, params }],
  }
}

// Footeren fjernes FØR parsning: Papa's skipEmptyLines ville sluge en tom/
// whitespace-footer, hvorefter et slice(0, -1) på de parsede rækker ville
// fjerne en rigtig datarække i stedet. Ét afsluttende linjeskift er ikke en
// footer; derefter ryger sidste linje uanset indhold.
function stripFooter(text: string): string {
  const lines = text.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  lines.pop()
  return lines.join('\n')
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size))
}

// PostgREST svarer med højst 1000 rækker pr. kald (uanset rolle) — hent ALT
// sidevis, ellers ser diff'en kun de første 1000 medarbejdere og behandler
// resten som nye.
const PAGE_SIZE = 1000
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw error
    all.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE_SIZE) return all
  }
}

export async function processEmployeeCsv(
  admin: SupabaseClient,
  companyId: string,
  rawText: string,
  cfgInput?: Partial<ImportConfig> | null,
  opts?: ImportOptions,
): Promise<ImportResult> {
  const cfg: ImportConfig = { ...IMPORT_CONFIG_DEFAULTS, ...(cfgInput ?? {}) }

  let text = rawText
  if (text.includes('�')) return reject('encoding')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // BOM
  if (cfg.has_footer) text = stripFooter(text)

  // Separator-mismatch: hvis den konfigurerede separator kun giver én kolonne,
  // men filen tydeligvis bruger en anden, afvis med besked.
  const detectSeparatorMismatch = (columnsFound: number): string | null => {
    if (columnsFound > 1 || cfg.fields.length <= 1) return null
    const sniff = Papa.parse<string[]>(text, { skipEmptyLines: true, preview: 5 })
    const detected = sniff.meta.delimiter
    if (detected && detected !== cfg.separator && (sniff.data[0]?.length ?? 0) > 1) return detected
    return null
  }

  let records: RawRecord[] = []
  let firstDataRow: number
  // Felter filen ejer (kolonne til stede). Kun disse skrives/sammenlignes.
  const owned = new Set<string>()

  if (!cfg.has_header) {
    const parsed = Papa.parse<string[]>(text, { delimiter: cfg.separator, skipEmptyLines: true })
    if (parsed.errors.some((e) => e.type === 'Delimiter')) return reject('parse')
    const mismatch = detectSeparatorMismatch(parsed.data[0]?.length ?? 0)
    if (mismatch) return reject('separatorMismatch', parsed.data.length, { sep: cfg.separator, found: mismatch })
    firstDataRow = 1
    for (const key of cfg.fields) {
      if (key === 'name') owned.add('full_name')
      else if (key === 'first_name' || key === 'last_name') { owned.add(key); owned.add('full_name') }
      else if (key !== 'employee_no') owned.add(key)
    }
    records = parsed.data.map((cols) => {
      const rec: RawRecord = {}
      cfg.fields.forEach((key, i) => {
        const mapped = key === 'name' ? 'full_name' : key
        rec[mapped] = cols[i]
      })
      return rec
    })
  } else {
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      delimiter: cfg.separator,
      skipEmptyLines: true,
      transformHeader: normalizeHeader,
    })
    if (parsed.errors.some((e) => e.type === 'Delimiter')) return reject('parse')

    const activeFields = new Set(
      cfg.fields
        .map((k) => (k === 'name' ? 'full_name' : k))
        .concat(cfg.fields.includes('name') ? ['first_name', 'last_name'] : []),
    )
    const headers = parsed.meta.fields ?? []
    const mismatch = detectSeparatorMismatch(headers.length)
    if (mismatch) return reject('separatorMismatch', parsed.data.length, { sep: cfg.separator, found: mismatch })

    const fieldFor: Record<string, string> = {}
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (!activeFields.has(field)) continue
      const hit = headers.find((h) => aliases.includes(h))
      if (hit) fieldFor[field] = hit
    }
    const hasNameColumns = !!fieldFor.full_name || (!!fieldFor.first_name && !!fieldFor.last_name)
    const missing = [
      ...(!fieldFor.employee_no ? ['employee_no'] : []),
      ...(!hasNameColumns ? ['name'] : []),
    ]
    if (missing.length) return reject('missingColumns', parsed.data.length, { cols: missing.join(',') })

    if (fieldFor.full_name) owned.add('full_name')
    if (fieldFor.first_name && fieldFor.last_name) {
      owned.add('first_name')
      owned.add('last_name')
      owned.add('full_name') // afledes af fornavn + efternavn
    }
    for (const f of ['initials', 'email', 'phone', 'department', 'language', 'nfc_card_id', 'role']) {
      if (fieldFor[f]) owned.add(f)
    }

    firstDataRow = 2
    records = parsed.data.map((raw) => {
      const rec: RawRecord = {}
      for (const [field, col] of Object.entries(fieldFor)) rec[field] = raw[col]
      return rec
    })
  }

  if (records.length === 0) return reject('empty')

  // Række-validering (fælles).
  const rows: CsvRow[] = []
  const errors: RowError[] = []
  const seen = new Set<string>()
  records.forEach((rec, i) => {
    const rowNumber = i + firstDataRow
    const employee_no = clean(rec.employee_no)
    const first_name = clean(rec.first_name)
    const last_name = clean(rec.last_name)
    const full_name = clean(rec.full_name) ?? ([first_name, last_name].filter(Boolean).join(' ') || null)
    if (!employee_no) return void errors.push({ row: rowNumber, code: 'missingEmployeeNo' })
    if (!full_name) return void errors.push({ row: rowNumber, code: 'missingName' })
    if (seen.has(employee_no)) return void errors.push({ row: rowNumber, code: 'duplicateEmployeeNo' })
    seen.add(employee_no)
    rows.push({
      rowNumber, employee_no, full_name, first_name, last_name,
      initials: clean(rec.initials), email: clean(rec.email), phone: clean(rec.phone),
      department: clean(rec.department), language: clean(rec.language),
      nfc_card_id: clean(rec.nfc_card_id), role: clean(rec.role),
    })
  })

  // Nuværende tilstand (sidevis — se fetchAllPages).
  type ExistingEmployee = {
    id: string; employee_no: string | null; full_name: string; first_name: string | null
    last_name: string | null; initials: string | null; email: string | null; phone: string | null
    language: string; department_id: string | null; is_active: boolean; is_manual: boolean
    nfc_card_id: string | null; role: string | null
  }
  const [employees, departments] = await Promise.all([
    fetchAllPages<ExistingEmployee>((from, to) =>
      admin.from('employees')
        .select('id, employee_no, full_name, first_name, last_name, initials, email, phone, language, department_id, is_active, is_manual, nfc_card_id, role')
        .eq('company_id', companyId)
        .order('id')
        .range(from, to),
    ),
    fetchAllPages<{ id: string; name: string }>((from, to) =>
      admin.from('departments').select('id, name').eq('company_id', companyId).order('id').range(from, to),
    ),
  ])

  const deptByName = new Map<string, { id: string; name: string }>(
    departments.map((d) => [d.name.toLowerCase(), d]),
  )
  const byNo = new Map(
    employees.filter((e) => e.employee_no).map((e) => [e.employee_no as string, e]),
  )

  const creates: CsvRow[] = []
  const updates: { row: CsvRow; existing: ExistingEmployee }[] = []
  let unchanged = 0
  let skippedManual = 0
  const newDepartments = new Set<string>()

  for (const row of rows) {
    if (row.department && !deptByName.has(row.department.toLowerCase())) newDepartments.add(row.department)
    const existing = byNo.get(row.employee_no)
    if (!existing) { creates.push(row); continue }
    if (existing.is_manual) { skippedManual++; continue }
    const targetDept = row.department ? (deptByName.get(row.department.toLowerCase())?.id ?? 'NEW') : null
    const changed =
      (owned.has('full_name') && existing.full_name !== row.full_name) ||
      (owned.has('first_name') && (existing.first_name ?? null) !== row.first_name) ||
      (owned.has('last_name') && (existing.last_name ?? null) !== row.last_name) ||
      (owned.has('nfc_card_id') && (existing.nfc_card_id ?? null) !== row.nfc_card_id) ||
      (owned.has('role') && (existing.role ?? null) !== row.role) ||
      (owned.has('initials') && (existing.initials ?? null) !== row.initials) ||
      (owned.has('email') && (existing.email ?? null) !== row.email) ||
      (owned.has('phone') && (existing.phone ?? null) !== row.phone) ||
      (owned.has('language') && row.language !== null && existing.language !== row.language) ||
      (owned.has('department') && (existing.department_id ?? null) !== (targetDept === 'NEW' ? 'NEW' : targetDept)) ||
      !existing.is_active
    if (changed) updates.push({ row, existing })
    else unchanged++
  }

  const fileNos = new Set(rows.map((r) => r.employee_no))
  const deactivations = employees
    .filter((e) => !e.is_manual && e.is_active && e.employee_no && !fileNos.has(e.employee_no))
    .map((e) => e.id)

  if (opts?.guardDeactivations && deactivations.length >= DEACTIVATION_GUARD_MIN) {
    const activeImported = employees.filter((e) => !e.is_manual && e.is_active && e.employee_no).length
    if (deactivations.length > activeImported * DEACTIVATION_GUARD_RATIO) {
      return reject('tooManyDeactivations', rows.length + errors.length, {
        count: String(deactivations.length),
        active: String(activeImported),
      })
    }
  }

  // ── Anvend ──
  const counts = {
    rows_total: rows.length + errors.length,
    created: 0, updated: 0, unchanged, deactivated: 0, skippedManual, departments: 0,
  }

  try {
    // 1) nye afdelinger
    const deptIdByName = new Map<string, string>()
    deptByName.forEach((d, name) => deptIdByName.set(name, d.id))
    if (newDepartments.size) {
      const { data: created, error } = await admin
        .from('departments')
        .insert([...newDepartments].map((name) => ({ company_id: companyId, name })))
        .select('id, name')
      if (error) throw error
      ;(created ?? []).forEach((d) => deptIdByName.set(d.name.toLowerCase(), d.id))
      counts.departments = created?.length ?? 0
    }

    // Kun ejede felter skrives; resten forbliver urørt i databasen. Sprog med
    // tom celle beholder den eksisterende værdi (kolonnen er not-null).
    const mapRow = (row: CsvRow, existing?: ExistingEmployee) => {
      const rec: Record<string, unknown> = {
        company_id: companyId,
        employee_no: row.employee_no,
        is_active: true,
        is_manual: false,
      }
      if (owned.has('full_name')) rec.full_name = row.full_name
      if (owned.has('first_name')) rec.first_name = row.first_name
      if (owned.has('last_name')) rec.last_name = row.last_name
      if (owned.has('nfc_card_id')) rec.nfc_card_id = row.nfc_card_id
      if (owned.has('role')) rec.role = row.role
      if (owned.has('initials')) rec.initials = row.initials
      if (owned.has('email')) rec.email = row.email
      if (owned.has('phone')) rec.phone = row.phone
      if (owned.has('language')) rec.language = row.language ?? existing?.language ?? 'da'
      if (owned.has('department')) {
        rec.department_id = row.department ? (deptIdByName.get(row.department.toLowerCase()) ?? null) : null
      }
      return rec
    }

    // 2) oprettelser
    await chunked(creates, 500, async (chunk) => {
      const { data, error } = await admin.from('employees').insert(chunk.map((r) => mapRow(r))).select('id')
      if (error) throw error
      counts.created += data?.length ?? 0
    })

    // 3) opdateringer (upsert på id — kun de ejede kolonner sendes/ændres)
    await chunked(updates, 500, async (chunk) => {
      const { data, error } = await admin
        .from('employees')
        .upsert(chunk.map((u) => ({ id: u.existing.id, ...mapRow(u.row, u.existing) })))
        .select('id')
      if (error) throw error
      counts.updated += data?.length ?? 0
    })

    // 4) deaktiveringer
    await chunked(deactivations, 500, async (chunk) => {
      const { data, error } = await admin
        .from('employees')
        .update({ is_active: false })
        .in('id', chunk)
        .select('id')
      if (error) throw error
      counts.deactivated += data?.length ?? 0
    })
  } catch (e) {
    const err: ImportApplyError = e instanceof Error ? e : new Error(String(e))
    err.partialCounts = counts
    throw err
  }

  return { status: 'applied', counts, errors }
}

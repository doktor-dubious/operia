import { buildCsv, dateStamp, downloadBlob, type CsvRecord } from '@/lib/csv-export'
import { supabase } from '@/lib/supabase'

export { downloadBlob }

// Samlet kundeudtræk ved ophør (EVU-krav F-08).
//
// Udvælgelsen ligger i basen (`company_export_catalog`), ikke her: en klient,
// der selv må navngive tabeller, er en klient, der kan bede om hemmelighederne.
// Denne fil henter det, serveren tilbyder, og pakker det.
//
// Hvorfor ZIP og ikke én CSV: en virksomheds data er 30-50 tabeller med hver
// sine kolonner. Presset ned i én fil bliver de ulæselige for både mennesker og
// regneark. Én CSV pr. tabel, i mapper efter produkt, plus et manifest og en
// læsevejledning — det er den form, en modtager faktisk kan bruge.

export type ExportGroup = { key: string; labelKey: string; product: boolean }

/** Grupperne som de vises. `core` er ikke et produkt og står først. */
export const EXPORT_GROUPS: ExportGroup[] = [
  { key: 'core', labelKey: 'companyExport.groupCore', product: false },
  { key: 'parcels', labelKey: 'companyExport.groupParcels', product: true },
  { key: 'assets', labelKey: 'companyExport.groupAssets', product: true },
  { key: 'lager', labelKey: 'companyExport.groupLager', product: true },
  { key: 'lockers', labelKey: 'companyExport.groupLockers', product: true },
  { key: 'shipping', labelKey: 'companyExport.groupShipping', product: true },
  { key: 'routes', labelKey: 'companyExport.groupRoutes', product: true },
  { key: 'booking', labelKey: 'companyExport.groupBooking', product: true },
]

/**
 * Hvor filerne står, og hvilken kolonne der peger på dem.
 *
 * Stierne HARVESTES fra de rækker, der alligevel eksporteres, frem for at
 * blive listet ud af Storage. To grunde: en fil, ingen række peger på, er en
 * forældreløs rest, som oprydningsjobbet skal fjerne — ikke noget kunden skal
 * have udleveret — og en liste, der stemmer med CSV'erne, kan efterprøves.
 * Undtagelsen er designbillederne, som kun findes som URL'er inde i en
 * JSON-klump; dem listes hele virksomhedens mappe for.
 */
const FILE_SOURCES: { table: string; column: string; bucket: string }[] = [
  { table: 'parcels', column: 'condition_photo_path', bucket: 'parcel-photos' },
  { table: 'parcels', column: 'delivered_signature_path', bucket: 'signatures' },
  { table: 'parcel_documents', column: 'storage_path', bucket: 'parcel-photos' },
  { table: 'asset_documents', column: 'storage_path', bucket: 'asset-photos' },
]

const LOGO_BUCKET = 'company-logos'

/**
 * Loft over hvor mange bytes filer pakken må bære.
 *
 * Pakken bygges i browserens hukommelse. En kunde med ti tusind tilstandsfotos
 * ville vælte fanen, og en fane, der dør midt i en udlevering, er værre end en
 * pakke, der siger hvad den mangler. Rammes loftet, kommer resten med i
 * filer.csv med status `for_stor_pakke`, så listen stadig er komplet.
 */
const FILE_BUDGET_BYTES = 150 * 1024 * 1024

export type ExportFile = {
  bucket: string
  path: string
  bytes: number
  status: 'included' | 'skipped_budget' | 'missing'
}

export type ManifestTable = {
  group: string
  table: string
  rows: number
  /** Kolonnerne i tabellens egen rækkefølge — se manifestet i basen. */
  columns: string[]
}

export type ExportManifest = {
  generated_at: string
  company: { id: string; name: string; registration_no: string | null; created_at: string }
  groups: string[]
  tables: ManifestTable[]
  total_rows: number
  excludes: string[]
}

/** Manifestet plus billetten: udtrækket er logget serverside under dette id. */
export type StartedExport = ExportManifest & { export_id: string }

export async function fetchManifest(
  companyId: string,
  groups: string[],
): Promise<ExportManifest> {
  const { data, error } = await supabase.rpc('company_export_manifest', {
    p_company_id: companyId,
    p_groups: groups,
  })
  if (error) throw error
  return data as unknown as ExportManifest
}

/**
 * Start udtrækket. Serveren skriver 'privacy.full_export' i loggen FØR den
 * første række udleveres og giver et export_id tilbage, som hvert rækkeopslag
 * skal bære. Manifestet fra fetchManifest er kun en optælling; det er dette
 * kald, der er udleveringen.
 */
export async function beginExport(companyId: string, groups: string[]): Promise<StartedExport> {
  const { data, error } = await supabase.rpc('company_export_begin', {
    p_company_id: companyId,
    p_groups: groups,
  })
  if (error) throw error
  return data as unknown as StartedExport
}

const PAGE = 2000

/**
 * Hent én tabel helt, side for side.
 *
 * Sidens sidste `id` er markøren til næste side. Har tabellen ingen id-kolonne,
 * kommer alt i første side, og løkken stopper af sig selv — serveren afgør
 * hvilken af de to der gælder, klienten behøver ikke vide det.
 */
async function fetchTable(
  companyId: string,
  exportId: string,
  table: string,
  onRows: (n: number) => void,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  let after: string | undefined
  for (;;) {
    const { data, error } = await supabase.rpc('company_export_rows', {
      p_company_id: companyId,
      p_table: table,
      p_export_id: exportId,
      p_after: after,
      p_limit: PAGE,
    })
    if (error) throw error
    const page = (data ?? []) as unknown as Record<string, unknown>[]
    out.push(...page)
    onRows(page.length)
    if (page.length < PAGE) break
    const last = page[page.length - 1]
    const id = last?.id
    // uuid-id'er kommer som tekst, bigint-id'er (audit_log, parcel_events, …)
    // som TAL i jsonb. Begge er markører; serveren caster til id'ets type.
    // Kun en manglende id-kolonne (konfigurationstabel i én side) stopper her.
    if (typeof id !== 'string' && typeof id !== 'number') {
      if (page.length >= PAGE) throw new Error(`export_cursor_missing:${table}`)
      break
    }
    after = String(id)
  }
  return out
}

/**
 * Rækkerne som CSV.
 *
 * Kolonnerne kommer fra manifestet, dvs. tabellens egen rækkefølge: jsonb har
 * ingen kolonneorden, så uden listen ville felterne stå tilfældigt, og en tom
 * tabel ville give en fil uden hoved — som ikke kan skelnes fra en fejl. Skulle
 * en række alligevel bære et felt, listen ikke kender, føjes det til bagest
 * frem for at blive tabt. Sammensatte værdier (jsonb-detaljer, arrays) skrives
 * som JSON i cellen; de er stadig maskinlæsbare, og alternativet er at tabe dem.
 */
export function rowsToCsv(
  rows: Record<string, unknown>[],
  separator: string,
  columns: string[] = [],
): string {
  const fields: string[] = [...columns]
  const seen = new Set<string>(fields)
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k)
        fields.push(k)
      }
    }
  }
  const records: CsvRecord[] = rows.map((r) => {
    const rec: CsvRecord = {}
    for (const f of fields) {
      const v = r[f]
      rec[f] =
        v == null
          ? ''
          : typeof v === 'object'
            ? JSON.stringify(v)
            : typeof v === 'boolean'
              ? String(v)
              : (v as string | number)
    }
    return rec
  })
  return buildCsv({ hasHeader: true, hasFooter: false, separator, fields }, (f) => f, records)
}

/** Filnavnets stamme: kundens navn, renset, uden endelse. */
export function exportBaseName(companyName: string): string {
  const safe =
    companyName
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .toLowerCase() || 'kunde'
  return `operia-udtraek-${safe}-${dateStamp()}`
}

export type ExportProgress = {
  phase: 'rows' | 'files'
  /** Tabellen eller filen der arbejdes på lige nu. */
  label: string
  tablesDone: number
  tablesTotal: number
  rowsDone: number
  rowsTotal: number
  filesDone: number
  filesTotal: number
}

export type ExportResult = {
  files: number
  rows: number
  /** Filer der faktisk kom med — ikke det samme som `files`, der tæller CSV'er. */
  attachments: number
  blob: Blob
  fileName: string
}

/** Samler stierne fra de rækker, der eksporteres. */
function harvestFiles(table: string, rows: Record<string, unknown>[], into: Map<string, ExportFile>) {
  for (const src of FILE_SOURCES) {
    if (src.table !== table) continue
    for (const r of rows) {
      const v = r[src.column]
      if (typeof v !== 'string' || !v) continue
      const key = `${src.bucket}/${v}`
      if (!into.has(key)) into.set(key, { bucket: src.bucket, path: v, bytes: 0, status: 'missing' })
    }
  }
}

/** Designbillederne findes kun som URL'er inde i JSON — så mappen listes. */
async function harvestLogos(companyId: string, into: Map<string, ExportFile>) {
  const { data, error } = await supabase.storage.from(LOGO_BUCKET).list(companyId, { limit: 1000 })
  if (error || !data) return
  for (const f of data) {
    if (!f.name || f.id === null) continue // undermapper har id null
    const path = `${companyId}/${f.name}`
    const key = `${LOGO_BUCKET}/${path}`
    if (!into.has(key)) into.set(key, { bucket: LOGO_BUCKET, path, bytes: 0, status: 'missing' })
  }
}

/** Filoversigten som CSV, så pakkens indhold kan efterprøves linje for linje. */
function filesToCsv(files: ExportFile[], separator: string): string {
  return buildCsv(
    { hasHeader: true, hasFooter: false, separator, fields: ['bucket', 'path', 'bytes', 'status'] },
    (f) => f,
    files.map((f) => ({ bucket: f.bucket, path: f.path, bytes: f.bytes, status: f.status })),
  )
}

/**
 * Byg pakken.
 *
 * Tomme tabeller får også en fil, med kolonneoverskrifterne alene. En manglende
 * fil er tvetydig ("var der ingen, eller gik noget galt?"); en tom fil med
 * overskrifter svarer på spørgsmålet.
 */
export async function buildExport(opts: {
  companyId: string
  companyName: string
  /** Manifestet fra beginExport — bærer billetten (export_id). */
  manifest: StartedExport
  separator: string
  readme: string
  /** Tag fotos, underskrifter og designbilleder med. */
  includeFiles: boolean
  onProgress?: (p: ExportProgress) => void
}): Promise<ExportResult> {
  const { companyId, companyName, manifest, separator, readme, includeFiles, onProgress } = opts
  // Hentes først her: jszip er ~100 kB og bruges kun af denne ene dialog.
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const base = exportBaseName(companyName)
  const root = zip.folder(base)!

  let rowsDone = 0
  let tablesDone = 0
  let files = 0
  const found = new Map<string, ExportFile>()

  const report = (phase: 'rows' | 'files', label: string, filesDone = 0, filesTotal = 0) =>
    onProgress?.({
      phase,
      label,
      tablesDone,
      tablesTotal: manifest.tables.length,
      rowsDone,
      rowsTotal: manifest.total_rows,
      filesDone,
      filesTotal,
    })

  for (const entry of manifest.tables) {
    report('rows', entry.table)
    const rows = await fetchTable(companyId, manifest.export_id, entry.table, (n) => {
      rowsDone += n
      report('rows', entry.table)
    })
    if (includeFiles) harvestFiles(entry.table, rows, found)
    root
      .folder(entry.group)!
      .file(`${entry.table}.csv`, rowsToCsv(rows, separator, entry.columns ?? []))
    files += 1
    tablesDone += 1
  }

  // Filerne. Budgettet bruges op i den rækkefølge, stierne blev fundet; det er
  // ikke en prioritering, og derfor står hver overskydende fil i filer.csv med
  // sin status i stedet for bare at mangle.
  let attachments = 0
  if (includeFiles) {
    await harvestLogos(companyId, found)
    const list = [...found.values()]
    let budget = FILE_BUDGET_BYTES
    let done = 0
    for (const f of list) {
      report('files', f.path.split('/').pop() ?? f.path, done, list.length)
      if (budget <= 0) {
        f.status = 'skipped_budget'
        done += 1
        continue
      }
      const { data, error } = await supabase.storage.from(f.bucket).download(f.path)
      if (error || !data) {
        // Rækken peger på en fil, der ikke (længere) findes. Status siger det;
        // en tavs udeladelse ville se ud som en fejl i pakken.
        f.status = 'missing'
      } else if (data.size > budget) {
        f.status = 'skipped_budget'
        budget = 0
      } else {
        root.folder('filer')!.folder(f.bucket)!.file(f.path, data)
        f.bytes = data.size
        f.status = 'included'
        budget -= data.size
        attachments += 1
      }
      done += 1
      report('files', f.path.split('/').pop() ?? f.path, done, list.length)
    }
    root.file('filer.csv', filesToCsv(list, separator))
  }

  // Manifestet skrives til SIDST, så det kan fortælle hvad der rent faktisk kom
  // med — ikke kun hvad der var planen.
  root.file('README.txt', readme)
  root.file(
    'manifest.json',
    JSON.stringify(
      {
        ...manifest,
        files: includeFiles
          ? {
              included: attachments,
              missing: [...found.values()].filter((f) => f.status === 'missing').length,
              skipped_budget: [...found.values()].filter((f) => f.status === 'skipped_budget').length,
              listing: 'filer.csv',
            }
          : { included: 0, note: 'Filer blev fravalgt ved dette udtræk.' },
      },
      null,
      2,
    ),
  )

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return { files, rows: rowsDone, attachments, blob, fileName: `${base}.zip` }
}

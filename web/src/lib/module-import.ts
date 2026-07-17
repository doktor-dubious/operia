// Fælles importmotor for Aktiver- og Lager-modulerne. Aktiv- og lagerregistre
// ejes af importen (som medarbejdere ejes af Flow 0): rækker der mangler i
// filen deaktiveres. Modulet genbruger import_configs (import_type) og
// import_runs (kind) — samme validering, tørkørsel og upsert-semantik som
// medarbejderimporten, blot med hvert moduls egne felter.

export type ImportModule = 'assets' | 'inventory'

// text/number/date skrives direkte i modulets tabel; category/location er
// navne der slås op (eller oprettes) i asset_categories/asset_locations; enum
// er fri tekst der oversættes til en kanonisk nøgle (se `synonyms`).
export type ModuleFieldKind = 'text' | 'number' | 'date' | 'category' | 'location' | 'enum'

export type ModuleField = {
  key: string // konfigurationsnøgle; for text/number/date også kolonnenavnet
  kind: ModuleFieldKind
  aliases: string[] // normaliserede headeraliasser (da + en)
  synonyms?: Record<string, string> // kun 'enum': celletekst (lowercase) → kanonisk nøgle
  emptyValue?: string // NOT NULL-kolonne: tom celle → denne værdi (jf. zeroDefaultFields)
}

export type ModuleSpec = {
  module: ImportModule
  importType: 'assets' | 'inventory' // import_configs.import_type
  runKind: string // import_runs.kind
  table: 'assets' | 'inventory_items'
  keyField: string // upsert-nøgle + konfigurationsnøgle (asset_tag | sku)
  categoryTrack: 'serial' | 'qty' // track ved auto-oprettelse af kategorier
  i18nKey: string // 'moduleImport.assets' | 'moduleImport.inventory'
  fields: ModuleField[] // alle mulige felter, i kanonisk rækkefølge
  requiredKeys: string[] // felter der ikke kan fravælges/være tomme
  defaultFields: string[] // standard-aktive felter, i rækkefølge
  selectColumns: string // kolonner der hentes til tørkørslen
  zeroDefaultFields: string[] // NOT NULL-talkolonner: tom celle → 0
  // Felter med en unik-constraint pr. virksomhed UD OVER keyField. Anvend
  // sker i bidder uden transaktion, så en dublet ville vælte importen
  // halvvejs igennem og efterlade den delvist anvendt — derfor fanges de i
  // tørkørslen, hvor filen stadig kan rettes.
  uniqueFields: string[]
}

// Celletekst → kanonisk asset_status. Spejler asset_status_from_text i
// 20260717090000_asset_loans.sql — hold de to i sync. Status er en enum i
// databasen, så en ukendt værdi afvises i tørkørslen frem for at vælte
// anvendelsen midtvejs. on_loan-aliasserne ('udlånt' m.fl.) er MED VILJE
// udeladt: udlån ejes af lend_asset()/return_asset() (åbent lån + status
// følges ad), så en CSV kan hverken sætte eller rydde on_loan — databasens
// assets_status_guard (20260717200000) afviser det alligevel.
const ASSET_STATUS_SYNONYMS: Record<string, string> = {
  in_stock: 'in_stock',
  'in stock': 'in_stock',
  'på lager': 'in_stock',
  'pa lager': 'in_stock',
  assigned: 'assigned',
  'in use': 'assigned',
  'i brug': 'assigned',
  service: 'service',
  repair: 'service',
  'til service': 'service',
  'til reparation': 'service',
  retired: 'retired',
  udfaset: 'retired',
  udgået: 'retired',
  udgaaet: 'retired',
}

const NAME_ALIASES = ['navn', 'name', 'betegnelse', 'beskrivelse']
const CATEGORY_ALIASES = ['kategori', 'category', 'type']
const LOCATION_ALIASES = ['placering', 'lokation', 'location', 'sted']

const ASSET_FIELDS: ModuleField[] = [
  { key: 'asset_tag', kind: 'text', aliases: ['aktiv_nr', 'aktivnr', 'aktivnummer', 'aktiv_tag', 'tag', 'asset_tag', 'asset_no'] },
  { key: 'name', kind: 'text', aliases: NAME_ALIASES },
  { key: 'category', kind: 'category', aliases: CATEGORY_ALIASES },
  { key: 'location', kind: 'location', aliases: LOCATION_ALIASES },
  { key: 'serial_no', kind: 'text', aliases: ['serienr', 'serie_nr', 'serienummer', 'serial', 'serial_no', 'serial_number'] },
  { key: 'barcode', kind: 'text', aliases: ['stregkode', 'stregkode_nr', 'barcode', 'ean', 'gtin'] },
  // assets.status er NOT NULL default 'in_stock' — en tom celle betyder
  // derfor "på lager", ikke "ingen status".
  { key: 'status', kind: 'enum', aliases: ['status'], synonyms: ASSET_STATUS_SYNONYMS, emptyValue: 'in_stock' },
  { key: 'condition', kind: 'text', aliases: ['stand', 'tilstand', 'condition'] },
  { key: 'purchased_at', kind: 'date', aliases: ['koebsdato', 'købsdato', 'koebt', 'purchased_at', 'purchase_date', 'bought'] },
  { key: 'purchase_price', kind: 'number', aliases: ['koebspris', 'købspris', 'pris', 'purchase_price', 'price', 'cost'] },
  { key: 'warranty_until', kind: 'date', aliases: ['garanti', 'garanti_udloeb', 'garanti_udløb', 'warranty', 'warranty_until'] },
]

const INVENTORY_FIELDS: ModuleField[] = [
  { key: 'sku', kind: 'text', aliases: ['sku', 'varenr', 'vare_nr', 'varenummer', 'artikelnr', 'artikel_nr', 'item_no'] },
  { key: 'name', kind: 'text', aliases: NAME_ALIASES },
  { key: 'category', kind: 'category', aliases: CATEGORY_ALIASES },
  { key: 'location', kind: 'location', aliases: LOCATION_ALIASES },
  { key: 'quantity', kind: 'number', aliases: ['antal', 'beholdning', 'quantity', 'qty', 'on_hand'] },
  { key: 'reorder_point', kind: 'number', aliases: ['genbestilling', 'genbestillingspunkt', 'reorder', 'reorder_point', 'min'] },
  { key: 'unit', kind: 'text', aliases: ['enhed', 'unit', 'uom'] },
  { key: 'unit_cost', kind: 'number', aliases: ['enhedspris', 'kostpris', 'unit_cost', 'cost'] },
  { key: 'on_order', kind: 'number', aliases: ['bestilt', 'paa_bestilling', 'på_bestilling', 'on_order', 'ordered'] },
]

export const MODULE_SPECS: Record<ImportModule, ModuleSpec> = {
  assets: {
    module: 'assets',
    importType: 'assets',
    runKind: 'assets_csv',
    table: 'assets',
    keyField: 'asset_tag',
    categoryTrack: 'serial',
    i18nKey: 'moduleImport.assets',
    fields: ASSET_FIELDS,
    requiredKeys: ['asset_tag', 'name'],
    defaultFields: ASSET_FIELDS.map((f) => f.key),
    selectColumns:
      'id, asset_tag, name, category_id, location_id, serial_no, barcode, status, condition, purchased_at, purchase_price, warranty_until, is_active',
    zeroDefaultFields: [],
    uniqueFields: ['barcode'], // assets_company_id_barcode_key
  },
  inventory: {
    module: 'inventory',
    importType: 'inventory',
    runKind: 'inventory_csv',
    table: 'inventory_items',
    keyField: 'sku',
    categoryTrack: 'qty',
    i18nKey: 'moduleImport.inventory',
    fields: INVENTORY_FIELDS,
    requiredKeys: ['sku', 'name'],
    defaultFields: INVENTORY_FIELDS.map((f) => f.key),
    selectColumns:
      'id, sku, name, category_id, location_id, quantity, reorder_point, unit, unit_cost, on_order, is_active',
    zeroDefaultFields: ['quantity', 'on_order'],
    uniqueFields: [], // sku er keyField og tjekkes allerede som nøgle
  },
}

export function moduleFieldMap(spec: ModuleSpec): Record<string, ModuleField> {
  return Object.fromEntries(spec.fields.map((f) => [f.key, f]))
}

// Header → normaliseret nøgle (samme regel som medarbejderimporten).
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s.\-/]+/g, '_')
    .replace(/_+$/, '')
}

export type CoercedValue =
  | { ok: true; value: string | number | null }
  | { ok: false }

// Rå strengværdi → typet celleværdi. Tomme værdier bliver null; number
// accepterer komma-decimaler (da), date accepterer ISO og dd-mm-yyyy, enum
// accepterer den kanoniske nøgle og feltets da/en-etiketter.
export function coerceValue(field: ModuleField, raw: unknown): CoercedValue {
  const kind = field.kind
  const text = String(raw ?? '').trim()
  if (!text) return { ok: true, value: null }

  if (kind === 'enum') {
    const key = field.synonyms?.[text.toLowerCase()]
    return key ? { ok: true, value: key } : { ok: false }
  }

  if (kind === 'number') {
    // Med komma ('1.234,56') er punktum tusindtalsseparator og komma decimal.
    // Uden komma er punktum kun tusindtalsseparator når grupperingen er
    // utvetydig ('1.234.567'); ellers er det decimalpunkt, så eksportens rå
    // tal ('12.345') round-tripper uændret i stedet for at blive ganget 1000.
    const compact = text.replace(/\s/g, '')
    const normalized = compact.includes(',')
      ? compact.replace(/\./g, '').replace(',', '.')
      : /^-?\d{1,3}(\.\d{3}){2,}$/.test(compact)
        ? compact.replace(/\./g, '')
        : compact
    const num = Number(normalized)
    if (!Number.isFinite(num)) return { ok: false }
    return { ok: true, value: num }
  }

  if (kind === 'date') {
    // Komponent-grænser er ikke nok ('30.02.2026' ville passere og først
    // vælte Postgres midt i anvend) — kræv en reel kalenderdato.
    const isRealDate = (y: number, m: number, d: number) => {
      const dt = new Date(Date.UTC(y, m - 1, d))
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
    if (iso) {
      if (!isRealDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))) return { ok: false }
      return { ok: true, value: `${iso[1]}-${iso[2]}-${iso[3]}` }
    }
    const dmy = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/.exec(text)
    if (dmy) {
      const [, d, m, y] = dmy
      if (!isRealDate(Number(y), Number(m), Number(d))) return { ok: false }
      return { ok: true, value: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` }
    }
    return { ok: false }
  }

  // text / category / location
  return { ok: true, value: text }
}

// Sammenlign to celleværdier løst (null/'' er ens; tal vs. streng normaliseres),
// så tørkørslen ikke markerer uændrede rækker som opdateringer.
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
  return norm(a) === norm(b)
}

import daBundle from '@/i18n/locales/da.json'
import enBundle from '@/i18n/locales/en.json'

// Katalog over grænsefladetekster der kan overstyres pr. kunde/platform.
//
// Nøglen ER i18n-nøglen (fx 'receive.submitButton'). Det er med vilje: nøglerne
// findes allerede, er stabile på tværs af omformuleringer, og standardteksterne
// pr. sprog ligger allerede i locale-bundtet klienten har hentet. Databasen
// gemmer derfor KUN de rækker nogen faktisk har ændret — ikke ~2.600 standarder.
//
// Kategori/side udledes af nøglens navnerum (fx 'receive'), så kun ~107 poster
// skal vedligeholdes i hånden i stedet for én pr. tekst. NAMESPACE_META er
// udtømmende; assertNamespaceCoverage() (kaldt i dev) råber op hvis et nyt
// navnerum tilføjes til locale-filerne uden at blive placeret her.

export type TextPlatform = 'web' | 'handheld'

// Kategori-id → i18n-nøgle for etiketten (i textsPage.category_*).
export const TEXT_CATEGORIES = [
  'general',
  'parcels',
  'assets',
  'inventory',
  'booking',
  'routes',
  'shipping',
  'lockers',
  'directory',
  'reports',
  'config',
  'platform',
] as const
export type TextCategory = (typeof TEXT_CATEGORIES)[number]

type NamespaceMeta = { category: TextCategory; page: Record<string, string> }

// [navnerum]: kategori + sidenavn pr. sprog. Sidenavnet er den skærm teksten
// hører til — det er den kolonne en supporter filtrerer på ("hvor står det?").
const NAMESPACE_META: Record<string, NamespaceMeta> = {
  app: { category: 'general', page: { da: 'App', en: 'App' } },
  assetBoard: { category: 'assets', page: { da: 'Aktivtavle', en: 'Asset board' } },
  assetCalendar: { category: 'assets', page: { da: 'Aktivkalender', en: 'Asset calendar' } },
  assetCategoriesPage: { category: 'assets', page: { da: 'Aktivkategorier', en: 'Asset categories' } },
  assetDataConfig: { category: 'config', page: { da: 'Aktivdata', en: 'Asset data' } },
  assetEvents: { category: 'assets', page: { da: 'Aktivhistorik', en: 'Asset history' } },
  assetFlow: { category: 'assets', page: { da: 'Aktivflow', en: 'Asset flow' } },
  assetLocationsPage: { category: 'assets', page: { da: 'Aktivlokationer', en: 'Asset locations' } },
  assetsConfig: { category: 'config', page: { da: 'Aktivindstillinger', en: 'Asset settings' } },
  assetsPage: { category: 'assets', page: { da: 'Aktiver', en: 'Assets' } },
  auth: { category: 'general', page: { da: 'Log ind', en: 'Sign in' } },
  board: { category: 'parcels', page: { da: 'Pakketavle', en: 'Parcel board' } },
  bookingCalendar: { category: 'booking', page: { da: 'Bookingkalender', en: 'Booking calendar' } },
  bookingCategoriesPage: { category: 'booking', page: { da: 'Bookingkategorier', en: 'Booking categories' } },
  bookingConfig: { category: 'config', page: { da: 'Bookingindstillinger', en: 'Booking settings' } },
  bookingFlow: { category: 'booking', page: { da: 'Ny booking', en: 'New booking' } },
  bookingPage: { category: 'booking', page: { da: 'Bookinger', en: 'Bookings' } },
  bookingResourcesPage: { category: 'booking', page: { da: 'Bookingressourcer', en: 'Booking resources' } },
  carrierAgreements: { category: 'shipping', page: { da: 'Fragtaftaler', en: 'Carrier agreements' } },
  carrierDetail: { category: 'config', page: { da: 'Transportør', en: 'Carrier' } },
  carriersPage: { category: 'config', page: { da: 'Transportører', en: 'Carriers' } },
  changePassword: { category: 'general', page: { da: 'Skift adgangskode', en: 'Change password' } },
  colorPicker: { category: 'general', page: { da: 'Farvevælger', en: 'Colour picker' } },
  common: { category: 'general', page: { da: 'Fælles', en: 'Common' } },
  companyAi: { category: 'config', page: { da: 'AI-opsætning', en: 'AI setup' } },
  companyDataTransfer: { category: 'config', page: { da: 'Dataoverførsel', en: 'Data transfer' } },
  companyEntra: { category: 'config', page: { da: 'Entra ID', en: 'Entra ID' } },
  companyPrivacy: { category: 'config', page: { da: 'Privatliv', en: 'Privacy' } },
  companySwitcher: { category: 'general', page: { da: 'Virksomhedsskifter', en: 'Company switcher' } },
  condition: { category: 'parcels', page: { da: 'Tilstand', en: 'Condition' } },
  configureConfig: { category: 'config', page: { da: 'Konfigurér-menu', en: 'Configure menu' } },
  configureHandheldDesign: { category: 'config', page: { da: 'Håndterminal-design', en: 'Handheld design' } },
  configureHomeDesign: { category: 'config', page: { da: 'Forside-design', en: 'Home design' } },
  customerDetail: { category: 'platform', page: { da: 'Kunde', en: 'Customer' } },
  customersPage: { category: 'platform', page: { da: 'Kunder', en: 'Customers' } },
  dashboard: { category: 'parcels', page: { da: 'Overblik', en: 'Dashboard' } },
  dataTable: { category: 'general', page: { da: 'Tabeller', en: 'Tables' } },
  dataTransferPage: { category: 'platform', page: { da: 'Dataoverførsel (platform)', en: 'Data transfer (platform)' } },
  departmentDetail: { category: 'directory', page: { da: 'Afdeling', en: 'Department' } },
  departments: { category: 'directory', page: { da: 'Afdelinger', en: 'Departments' } },
  designField: { category: 'general', page: { da: 'Designfelter', en: 'Design fields' } },
  detail: { category: 'general', page: { da: 'Detaljepanel', en: 'Detail pane' } },
  employeeDetail: { category: 'directory', page: { da: 'Medarbejder', en: 'Employee' } },
  employees: { category: 'directory', page: { da: 'Medarbejdere', en: 'Employees' } },
  employeesActions: { category: 'directory', page: { da: 'Medarbejderhandlinger', en: 'Employee actions' } },
  errors: { category: 'general', page: { da: 'Fejl', en: 'Errors' } },
  exportPage: { category: 'general', page: { da: 'Eksport', en: 'Export' } },
  feedback: { category: 'general', page: { da: 'Feedback', en: 'Feedback' } },
  feedbackPage: { category: 'platform', page: { da: 'Feedback (Operia)', en: 'Feedback (Operia)' } },
  forgotPassword: { category: 'general', page: { da: 'Glemt adgangskode', en: 'Forgot password' } },
  handheldActions: { category: 'config', page: { da: 'Håndterminal', en: 'Handheld' } },
  handheldDesignPage: { category: 'config', page: { da: 'Håndterminal-design', en: 'Handheld design' } },
  handlingClassDetail: { category: 'config', page: { da: 'Håndteringsklasse', en: 'Handling class' } },
  handlingClasses: { category: 'config', page: { da: 'Håndteringsklasser', en: 'Handling classes' } },
  handout: { category: 'parcels', page: { da: 'Udlevering', en: 'Handout' } },
  home: { category: 'general', page: { da: 'Forside', en: 'Home' } },
  homeDesignPage: { category: 'config', page: { da: 'Forside-design', en: 'Home design' } },
  impersonate: { category: 'platform', page: { da: 'Skift bruger', en: 'Impersonate' } },
  importConfig: { category: 'config', page: { da: 'Importopsætning', en: 'Import setup' } },
  importPage: { category: 'config', page: { da: 'Import', en: 'Import' } },
  importReasons: { category: 'config', page: { da: 'Importfejl', en: 'Import errors' } },
  integrationsPage: { category: 'config', page: { da: 'Integrationer', en: 'Integrations' } },
  inventoryPage: { category: 'inventory', page: { da: 'Lager', en: 'Stock' } },
  labelDesigner: { category: 'config', page: { da: 'Labeldesign', en: 'Label design' } },
  locationDetail: { category: 'config', page: { da: 'Lokation', en: 'Location' } },
  locations: { category: 'config', page: { da: 'Lokationer', en: 'Locations' } },
  lockerDetail: { category: 'lockers', page: { da: 'Skab', en: 'Locker' } },
  lockersPage: { category: 'lockers', page: { da: 'Skabe', en: 'Lockers' } },
  logDrains: { category: 'platform', page: { da: 'Logudtræk', en: 'Log drains' } },
  loginSecurityPage: { category: 'config', page: { da: 'Login & sikkerhed', en: 'Login & security' } },
  logsPage: { category: 'platform', page: { da: 'Logbog', en: 'Logs' } },
  menu: { category: 'general', page: { da: 'Brugermenu', en: 'User menu' } },
  moduleImport: { category: 'config', page: { da: 'Modulimport', en: 'Module import' } },
  nav: { category: 'general', page: { da: 'Navigation', en: 'Navigation' } },
  notificationsPage: { category: 'config', page: { da: 'Notifikationer', en: 'Notifications' } },
  operiaConfig: { category: 'platform', page: { da: 'Operia-menu', en: 'Operia menu' } },
  operiaGeneralPage: { category: 'platform', page: { da: 'Operia generelt', en: 'Operia general' } },
  operiaLocalization: { category: 'platform', page: { da: 'Lokalisering (platform)', en: 'Localization (platform)' } },
  operiaMapsPage: { category: 'platform', page: { da: 'Kort', en: 'Maps' } },
  override: { category: 'parcels', page: { da: 'Modtager-override', en: 'Receiver override' } },
  parcelDetail: { category: 'parcels', page: { da: 'Pakkedetaljer', en: 'Parcel detail' } },
  parcels: { category: 'parcels', page: { da: 'Pakker', en: 'Parcels' } },
  personalData: { category: 'config', page: { da: 'Persondata', en: 'Personal data' } },
  products: { category: 'general', page: { da: 'Produkter', en: 'Products' } },
  productsPage: { category: 'config', page: { da: 'Produkter & funktioner', en: 'Products & features' } },
  receive: { category: 'parcels', page: { da: 'Modtag pakke', en: 'Receive parcel' } },
  removeParcel: { category: 'parcels', page: { da: 'Fjern pakke', en: 'Remove parcel' } },
  reports: { category: 'reports', page: { da: 'Rapporter', en: 'Reports' } },
  requestAccess: { category: 'general', page: { da: 'Anmod om adgang', en: 'Request access' } },
  retention: { category: 'config', page: { da: 'Opbevaring', en: 'Retention' } },
  routeDetail: { category: 'routes', page: { da: 'Rute', en: 'Route' } },
  routesPage: { category: 'routes', page: { da: 'Ruter', en: 'Routes' } },
  sar: { category: 'config', page: { da: 'Indsigtsudtræk', en: 'Subject access request' } },
  scanner: { category: 'general', page: { da: 'Scanner', en: 'Scanner' } },
  setPassword: { category: 'general', page: { da: 'Vælg adgangskode', en: 'Set password' } },
  settings: { category: 'general', page: { da: 'Præferencer', en: 'Preferences' } },
  shippingBilling: { category: 'shipping', page: { da: 'Forsendelsesafregning', en: 'Shipping billing' } },
  stats: { category: 'reports', page: { da: 'Statistik', en: 'Statistics' } },
  superuser: { category: 'platform', page: { da: 'Platform-admin', en: 'Platform admin' } },
  templateTokens: { category: 'config', page: { da: 'Skabelontokens', en: 'Template tokens' } },
  templatesPage: { category: 'config', page: { da: 'Beskedskabeloner', en: 'Message templates' } },
  textsPage: { category: 'config', page: { da: 'Tekster', en: 'Texts' } },
  theme: { category: 'general', page: { da: 'Tema', en: 'Theme' } },
  timezonePicker: { category: 'general', page: { da: 'Tidszonevælger', en: 'Timezone picker' } },
  unsaved: { category: 'general', page: { da: 'Ugemte ændringer', en: 'Unsaved changes' } },
  usage: { category: 'config', page: { da: 'Forbrug', en: 'Usage' } },
  userDetail: { category: 'config', page: { da: 'Bruger', en: 'User' } },
  usersPage: { category: 'config', page: { da: 'Brugere', en: 'Users' } },
}

// Tekster der IKKE må overstyres. Ikke af smag — de her strenge sammenlignes
// med hvad brugeren taster, så en omdøbning ville slå funktionen ihjel:
// bekræftelsesordet i sletnings-/anonymiseringsmodalerne matches mod en fast
// liste ('slet'/'delete') i data-table.tsx og employees.tsx.
const NON_OVERRIDABLE = new Set(['dataTable.deleteWord', 'employeesActions.anonymizeWord'])

// i18next-plurale endelser. Nøgler der kun adskiller sig ved endelsen hører til
// samme tekst og redigeres samlet — ellers retter man ental og glemmer flertal.
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other']

export type TextRow = {
  /** Stabilt række-id: basisnøglen (uden plural-endelse). */
  id: string
  platform: TextPlatform
  category: TextCategory
  /** Navnerummet — sidefiltret grupperer på dette. */
  namespace: string
  /** De faktiske i18n-nøgler rækken dækker (>1 ved plurale former). */
  keys: string[]
  /** Standardtekster fra locale-bundtet: lang → nøgle → tekst. */
  defaults: Record<string, Record<string, string>>
  /** {{navne}} i standardteksten — en overstyring skal bruge de samme. */
  placeholders: Record<string, string[]>
}

type Bundle = Record<string, unknown>

function flatten(obj: Bundle, prefix = '', out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Bundle, key, out)
    else if (typeof v === 'string') out[key] = v
  }
  return out
}

export const FLAT_BUNDLES: Record<string, Record<string, string>> = {
  da: flatten(daBundle as Bundle),
  en: flatten(enBundle as Bundle),
}

/** Sprog app'en rent faktisk har et bundt for — kun disse kan overstyres. */
export const BUNDLED_LANGS = Object.keys(FLAT_BUNDLES)

export function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.-]+)[^}]*\}\}/g)].map((m) => m[1]).sort()
}

function pluralBase(key: string): { base: string; isPlural: boolean } {
  const suffix = PLURAL_SUFFIXES.find((s) => key.endsWith(s))
  return suffix ? { base: key.slice(0, -suffix.length), isPlural: true } : { base: key, isPlural: false }
}

// Bygges én gang — kataloget er statisk for en given bundle.
let cachedRows: TextRow[] | null = null

export function textRows(): TextRow[] {
  if (cachedRows) return cachedRows

  // Dansk er kanonisk (fallbackLng): rækkerne findes for de nøgler da har.
  const byId = new Map<string, TextRow>()
  for (const key of Object.keys(FLAT_BUNDLES.da)) {
    if (NON_OVERRIDABLE.has(key)) continue
    const namespace = key.split('.')[0]
    const meta = NAMESPACE_META[namespace]
    if (!meta) continue // ukendt navnerum — assertNamespaceCoverage() fanger det i dev
    const { base } = pluralBase(key)
    let row = byId.get(base)
    if (!row) {
      row = {
        id: base,
        platform: 'web',
        category: meta.category,
        namespace,
        keys: [],
        defaults: {},
        placeholders: {},
      }
      byId.set(base, row)
    }
    row.keys.push(key)
    for (const lang of BUNDLED_LANGS) {
      const value = FLAT_BUNDLES[lang][key]
      if (value === undefined) continue
      ;(row.defaults[lang] ??= {})[key] = value
    }
    // Pladsholdere valideres mod den danske standard — den er kilden.
    const found = extractPlaceholders(FLAT_BUNDLES.da[key])
    if (found.length) row.placeholders[key] = found
  }

  cachedRows = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, 'da'))
  return cachedRows
}

/** Sidenavnet for et navnerum, på brugerfladens sprog. */
export function pageLabel(namespace: string, uiLang: string): string {
  const meta = NAMESPACE_META[namespace]
  if (!meta) return namespace
  return meta.page[uiLang.slice(0, 2)] ?? meta.page.da
}

/** Alle navnerum der har mindst én overskrivbar tekst, som filtervalg. */
export function pageOptions(uiLang: string): { value: string; label: string }[] {
  const seen = new Set(textRows().map((r) => r.namespace))
  return [...seen]
    .map((ns) => ({ value: ns, label: pageLabel(ns, uiLang) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'da'))
}

/**
 * Råber op hvis locale-filerne har fået et navnerum der ikke er placeret i
 * NAMESPACE_META — ellers ville de nye tekster bare forsvinde lydløst fra
 * Tekster-siden. Kun i dev; koster intet i produktion.
 */
export function assertNamespaceCoverage() {
  const missing = [...new Set(Object.keys(FLAT_BUNDLES.da).map((k) => k.split('.')[0]))].filter(
    (ns) => !NAMESPACE_META[ns],
  )
  if (missing.length) {
    console.warn(
      `[app-texts] Navnerum uden kategori/side i NAMESPACE_META — teksterne vises ikke på Tekster-siden: ${missing.join(', ')}`,
    )
  }
}

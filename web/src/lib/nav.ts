import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  ArrowLeftToLine,
  ArrowRightFromLine,
  Boxes,
  CalendarRange,
  Camera,
  Cog,
  FileText,
  Handshake,
  LayoutGrid,
  Layers,
  Lock,
  MapPin,
  Network,
  Package,
  PackageCheck,
  PackagePlus,
  Radio,
  Route,
  Search,
  Settings,
  Ship,
  SlidersHorizontal,
  Tag,
  Truck,
  Upload,
  Users,
} from 'lucide-react'

// Navigationsstruktur efter prototypens fulde scope (intra-app + admin-portal
// + assets-app foldet ind i én app). Grupper og punkter filtreres på adgang:
//  - rolle: canAccessPath (lib/roles.ts) afgør pr. punkt om brugerens roller
//    åbner siden (manager/platform-admin ser alt)
//  - productKey: kræver aktivt produkt for virksomheden (has_product)

import { canAccessPath, type AccessInfo } from '@/lib/roles'

export type { AccessInfo }

export type NavItem = {
  labelKey: string // i18n-nøgle under nav.*
  href: string
  icon: LucideIcon
  productKey?: string
  children?: { labelKey: string; href: string }[] // undermenu (fx Import)
}

export type NavGroup = {
  labelKey: string // i18n-nøgle under nav.*
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    labelKey: 'groupParcels',
    items: [
      { labelKey: 'parcelBoard', href: '/parcels/board', icon: Boxes },
      { labelKey: 'parcels', href: '/parcels/overview', icon: Package },
      { labelKey: 'receive', href: '/parcels/receive', icon: PackagePlus },
      { labelKey: 'handout', href: '/parcels/handout', icon: PackageCheck },
      { labelKey: 'move', href: '/parcels/move', icon: Truck },
      { labelKey: 'condition', href: '/parcels/condition', icon: Camera },
      { labelKey: 'search', href: '/parcels/search', icon: Search },
      { labelKey: 'reports', href: '/parcels/reports', icon: FileText },
      { labelKey: 'stats', href: '/parcels/stats', icon: Layers },
    ],
  },
  {
    labelKey: 'groupMasterData',
    items: [
      { labelKey: 'employees', href: '/employees', icon: Users },
      { labelKey: 'departments', href: '/departments', icon: Network },
      { labelKey: 'lockersData', href: '/lockers', icon: Lock, productKey: 'lockers' },
      {
        labelKey: 'import',
        href: '/import/local',
        icon: Upload,
        children: [
          { labelKey: 'importConfig', href: '/import/config' },
          { labelKey: 'importLocal', href: '/import/local' },
          { labelKey: 'exportData', href: '/import/export' },
          { labelKey: 'importLog', href: '/import/log' },
        ],
      },
    ],
  },
  {
    // Pakkernes egen stamdata — flyttet fra Stamdata, som nu kun er de
    // fælles registre (medarbejdere/afdelinger/skabe/import).
    labelKey: 'groupParcelManagement',
    items: [
      { labelKey: 'locations', href: '/locations', icon: MapPin },
      { labelKey: 'handlingClasses', href: '/handling-classes', icon: Handshake },
      { labelKey: 'carriers', href: '/carriers', icon: Truck },
    ],
  },
  {
    // Aktiver-modulet: flowsiderne (oversigt, tjek ud/ind, flyt, dokumentér,
    // søg) + registret og dets stamdata. Gates på assets-produktet pr. punkt.
    labelKey: 'groupAssetManagement',
    items: [
      { labelKey: 'assetBoard', href: '/assets/board', icon: Boxes, productKey: 'assets' },
      { labelKey: 'assets', href: '/assets', icon: Archive, productKey: 'assets' },
      { labelKey: 'assetCheckout', href: '/assets/checkout', icon: ArrowRightFromLine, productKey: 'assets' },
      { labelKey: 'assetCheckin', href: '/assets/checkin', icon: ArrowLeftToLine, productKey: 'assets' },
      { labelKey: 'assetMove', href: '/assets/move', icon: Truck, productKey: 'assets' },
      { labelKey: 'assetDocument', href: '/assets/document', icon: Camera, productKey: 'assets' },
      { labelKey: 'assetSearch', href: '/assets/search', icon: Search, productKey: 'assets' },
      { labelKey: 'assetCategories', href: '/assets/categories', icon: Tag, productKey: 'assets' },
      { labelKey: 'assetLocations', href: '/assets/locations', icon: MapPin, productKey: 'assets' },
      {
        labelKey: 'assetImport',
        href: '/assets/import/local',
        icon: Upload,
        productKey: 'assets',
        children: [
          { labelKey: 'importConfig', href: '/assets/import/config' },
          { labelKey: 'importLocal', href: '/assets/import/local' },
          { labelKey: 'exportData', href: '/assets/import/export' },
          { labelKey: 'importLog', href: '/assets/import/log' },
        ],
      },
    ],
  },
  {
    // Lager-modulet (Lager-produktet) — lagervarer på antal.
    labelKey: 'groupInventoryManagement',
    items: [
      { labelKey: 'inventoryItems', href: '/inventory', icon: Boxes, productKey: 'lager' },
      {
        labelKey: 'inventoryImport',
        href: '/inventory/import/local',
        icon: Upload,
        productKey: 'lager',
        children: [
          { labelKey: 'importConfig', href: '/inventory/import/config' },
          { labelKey: 'importLocal', href: '/inventory/import/local' },
          { labelKey: 'exportData', href: '/inventory/import/export' },
          { labelKey: 'importLog', href: '/inventory/import/log' },
        ],
      },
    ],
  },
  {
    labelKey: 'groupProducts',
    items: [
      { labelKey: 'lockers', href: '/products/lockers', icon: Lock, productKey: 'lockers' },
      { labelKey: 'iot', href: '/products/iot', icon: Radio, productKey: 'iot' },
      { labelKey: 'shipping', href: '/products/shipping', icon: Ship, productKey: 'shipping' },
      { labelKey: 'routes', href: '/products/routes', icon: Route, productKey: 'routes' },
      { labelKey: 'booking', href: '/products/booking', icon: CalendarRange, productKey: 'booking' },
    ],
  },
]

// Home — startsiden med produktfliserne. Står som øverste, selvstændige
// menupunkt (over grupperne) i sidemenuen og i bruger-dropdownen, med en
// separator under sig.
export const homeNav: NavItem = {
  labelKey: 'home',
  href: '/',
  icon: LayoutGrid,
}

export const settingsNav: NavItem = {
  labelKey: 'settings',
  href: '/settings',
  icon: Settings,
}

// Virksomhedskonfiguration — nederst i sidemenuen, over Operia. Vises for
// managers (egen virksomhed) og for platform-admins når en kunde er valgt i
// CompanySwitcheren. Samme sekundærmenu-layout som Operia-konfigurationen.
export const configureNav: NavItem = {
  labelKey: 'configure',
  href: '/configure',
  icon: SlidersHorizontal,
}

// En sektion i en sekundærmenu (Operia/Konfigurér): en overskrift + dens punkter.
// `labelKey` peger på sektionsoverskriften; menuernes egne i18n-namespaces
// (operiaConfig.* / configureConfig.*) holder overskrifterne.
export type ConfigNavSection = {
  labelKey: string
  items: { labelKey: string; href: string }[]
}

// Konfigurér-sekundærmenuen (kundefladen, reduceret sæt) grupperet i fire
// sektioner: konto/aftale, udseende, beskeder og data/integrationer.
export const configureConfigSections: ConfigNavSection[] = [
  {
    labelKey: 'sectionAccount',
    items: [
      { labelKey: 'configureUsers', href: '/configure/users' },
      { labelKey: 'configureProducts', href: '/configure/products' },
      { labelKey: 'configureBilling', href: '/configure/billing' },
      { labelKey: 'configureShipping', href: '/configure/shipping' },
    ],
  },
  {
    labelKey: 'sectionAppearance',
    items: [
      { labelKey: 'configureHomeDesign', href: '/configure/home-design' },
      { labelKey: 'configureHandheldDesign', href: '/configure/handheld-design' },
      { labelKey: 'configureLocalization', href: '/configure/localization' },
    ],
  },
  {
    labelKey: 'sectionMessaging',
    items: [
      { labelKey: 'configureTemplates', href: '/configure/templates' },
      { labelKey: 'configureNotifications', href: '/configure/notifications' },
    ],
  },
  {
    labelKey: 'sectionData',
    items: [
      { labelKey: 'configureDataTransfer', href: '/configure/data-transfer' },
      { labelKey: 'configureIntegrations', href: '/configure/integrations' },
      { labelKey: 'configureLogDrains', href: '/configure/log-drains' },
    ],
  },
]

// Flad liste (rækkefølge = sektionernes) — bruges af allNavItems m.fl.
export const configureConfigNav = configureConfigSections.flatMap((s) => s.items)

// Operia-konfiguration (kun platform-admins) — nederst i sidemenuen. Åbner en
// Supabase-settings-lignende side med egen venstremenu (operiaConfigNav).
export const operiaNav: NavItem = {
  labelKey: 'operia',
  href: '/operia',
  icon: Cog,
}

// Operia-sekundærmenuen (kun platform-admins) grupperet i seks sektioner, så
// den før så overfyldte "Konfiguration"-liste er delt op efter domæne.
export const operiaConfigSections: ConfigNavSection[] = [
  {
    labelKey: 'sectionTenants',
    items: [
      { labelKey: 'operiaCustomers', href: '/operia/customers' },
      { labelKey: 'operiaUsers', href: '/operia/users' },
      { labelKey: 'operiaFeedback', href: '/operia/feedback' },
    ],
  },
  {
    labelKey: 'sectionProducts',
    items: [
      { labelKey: 'operiaProducts', href: '/operia/products' },
      { labelKey: 'operiaCarriers', href: '/operia/carriers' },
      { labelKey: 'operiaShipping', href: '/operia/shipping' },
      { labelKey: 'operiaAssets', href: '/operia/assets' },
      { labelKey: 'operiaMaps', href: '/operia/maps' },
    ],
  },
  {
    labelKey: 'sectionAppearance',
    items: [
      { labelKey: 'operiaHomeDesign', href: '/operia/home-design' },
      { labelKey: 'operiaHandheldDesign', href: '/operia/handheld-design' },
      { labelKey: 'operiaLocalization', href: '/operia/localization' },
      { labelKey: 'operiaTemplates', href: '/operia/templates' },
      { labelKey: 'operiaNotifications', href: '/operia/notifications' },
    ],
  },
  {
    labelKey: 'sectionData',
    items: [
      { labelKey: 'operiaDataTransfer', href: '/operia/data-transfer' },
      { labelKey: 'operiaIntegrations', href: '/operia/integrations' },
    ],
  },
  {
    labelKey: 'sectionPlatform',
    items: [
      { labelKey: 'operiaGeneral', href: '/operia/general' },
      { labelKey: 'operiaBilling', href: '/operia/billing' },
    ],
  },
  {
    labelKey: 'sectionMonitoring',
    items: [
      { labelKey: 'operiaLogs', href: '/operia/logs' },
      { labelKey: 'operiaLogDrains', href: '/operia/log-drains' },
    ],
  },
]

// Flad liste (rækkefølge = sektionernes) — bruges af allNavItems m.fl.
export const operiaConfigNav = operiaConfigSections.flatMap((s) => s.items)

// Filtrér grupper/punkter efter brugerens adgang. Uden adgangsinfo (endnu
// ikke hentet) vises ingen grupper — så punkter ikke blinker frem og
// forsvinder igen. Home/Indstillinger står uden for grupperne og er åbne.
// Forenklet navigation ('modern'): de store knapper i sidemenuen er det
// daglige arbejde — tavle/overblik plus modtag/udlever/flyt/tilstand/søg.
// Listesiderne (oversigt, rapporter, statistik) hører ikke til det daglige
// klik-flow og ligger i stedet i bund-dropdownen sammen med resten af
// menutræet, jf. modernMenuNavGroups. Adgang filtreres pr. punkt
// (canAccessPath), så fx statistik kun vises for managers. Rækkefølgen her er
// den viste og følger hver modulgruppes orden.
//
// Modulerne står efter hinanden, hvert med sin tavle først og derefter de
// daglige flows. Sidemenuen sætter selv en streg, hvor modulet skifter (den
// læser stiens første segment), så listen her forbliver en flad rækkefølge.
// Aktiv-punkterne bærer productKey 'assets' i navGroups og filtreres derfor
// helt væk hos kunder uden modulet — der ser skinnen ud præcis som før.
export const SIMPLE_NAV_HREFS = [
  '/parcels/board',
  '/parcels/receive',
  '/parcels/handout',
  '/parcels/move',
  '/parcels/condition',
  '/parcels/search',
  '/assets/board',
  '/assets/checkout',
  '/assets/checkin',
  '/assets/move',
  '/assets/document',
  '/assets/search',
]

export function simpleNavItems(access: AccessInfo | undefined): NavItem[] {
  if (!access) return []
  const byHref = new Map(navGroups.flatMap((g) => g.items).map((i) => [i.href, i]))
  return SIMPLE_NAV_HREFS.map((href) => byHref.get(href)).filter(
    (item): item is NavItem =>
      !!item &&
      (!item.productKey || access.isPlatformAdmin || access.products.has(item.productKey)) &&
      canAccessPath(item.href, access),
  )
}

// De samme knapper delt op pr. modul, så skinnen kan give hvert modul sin egen
// overskrift med fold-op/ned. Gruppen (og dens navn) hentes fra navGroups —
// altså det samme modulnavn som den klassiske sidemenu bruger — frem for at
// være en ny liste, der kunne komme ud af trit med SIMPLE_NAV_HREFS.
// Rækkefølgen er SIMPLE_NAV_HREFS'; en ny gruppe begynder, hver gang et punkt
// hører til en anden navGroup end det forrige.
export type SimpleNavGroup = { labelKey: string; items: NavItem[] }

export function simpleNavGroups(access: AccessInfo | undefined): SimpleNavGroup[] {
  const groupOf = new Map<string, string>()
  for (const group of navGroups) {
    for (const item of group.items) groupOf.set(item.href, group.labelKey)
  }
  const out: SimpleNavGroup[] = []
  for (const item of simpleNavItems(access)) {
    const labelKey = groupOf.get(item.href)
    if (!labelKey) continue // punkt uden gruppe — kan ikke få en overskrift
    const last = out.at(-1)
    if (last?.labelKey === labelKey) last.items.push(item)
    else out.push({ labelKey, items: [item] })
  }
  return out
}

// Bund-dropdownen i moderne tilstand ("startmenuen"): hele menutræet minus de
// punkter der allerede står som store knapper i sidemenuen. Pakkegruppen
// forsvinder derfor ikke længere helt — oversigt/rapporter/statistik bliver
// tilbage her, så alt i modulet kan nås ét sted fra.
export function modernMenuNavGroups(access: AccessInfo | undefined): NavGroup[] {
  const inRail = new Set(SIMPLE_NAV_HREFS)
  return visibleNavGroups(access)
    .map((group) => ({ ...group, items: group.items.filter((item) => !inRail.has(item.href)) }))
    .filter((group) => group.items.length > 0)
}

export function visibleNavGroups(access: AccessInfo | undefined): NavGroup[] {
  if (!access) return []
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.productKey || access.isPlatformAdmin || access.products.has(item.productKey)) &&
          canAccessPath(item.href, access),
      ),
    }))
    .filter((group) => group.items.length > 0)
}

export const allNavItems = [
  homeNav,
  ...navGroups.flatMap((g) => g.items),
  ...navGroups.flatMap((g) =>
    g.items.flatMap((item) =>
      (item.children ?? []).map((child) => ({ ...child, icon: item.icon })),
    ),
  ),
  settingsNav,
  configureNav,
  ...configureConfigNav.map((c) => ({ ...c, icon: configureNav.icon })),
  operiaNav,
  ...operiaConfigNav.map((c) => ({ ...c, icon: operiaNav.icon })),
]

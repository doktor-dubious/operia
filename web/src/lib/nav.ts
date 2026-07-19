import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Boxes,
  CalendarRange,
  Cog,
  FileText,
  Handshake,
  LayoutDashboard,
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
      { labelKey: 'dashboard', href: '/parcels/dashboard', icon: LayoutDashboard },
      { labelKey: 'parcels', href: '/parcels', icon: Package },
      { labelKey: 'receive', href: '/parcels/receive', icon: PackagePlus },
      { labelKey: 'handout', href: '/parcels/handout', icon: PackageCheck },
      { labelKey: 'reports', href: '/reports', icon: FileText },
      { labelKey: 'stats', href: '/stats', icon: Layers },
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
    // Aktiver-modulet (pladsholdere indtil modulet bygges). Gates på
    // assets-produktet pr. punkt.
    labelKey: 'groupAssetManagement',
    items: [
      { labelKey: 'assets', href: '/assets', icon: Archive, productKey: 'assets' },
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

export const configureConfigNav: { labelKey: string; href: string }[] = [
  { labelKey: 'configureUsers', href: '/configure/users' },
  { labelKey: 'configureProducts', href: '/configure/products' },
  { labelKey: 'configureTemplates', href: '/configure/templates' },
  { labelKey: 'configureLocalization', href: '/configure/localization' },
  { labelKey: 'configureNotifications', href: '/configure/notifications' },
  { labelKey: 'configureBilling', href: '/configure/billing' },
  { labelKey: 'configureShipping', href: '/configure/shipping' },
  { labelKey: 'configureLogo', href: '/configure/logo' },
  { labelKey: 'configureAppearance', href: '/configure/appearance' },
  { labelKey: 'configureHomeDesign', href: '/configure/home-design' },
  { labelKey: 'configureDataTransfer', href: '/configure/data-transfer' },
  { labelKey: 'configureLogDrains', href: '/configure/log-drains' },
]

// Operia-konfiguration (kun platform-admins) — nederst i sidemenuen. Åbner en
// Supabase-settings-lignende side med egen venstremenu (operiaConfigNav).
export const operiaNav: NavItem = {
  labelKey: 'operia',
  href: '/operia',
  icon: Cog,
}

export const operiaConfigNav: { labelKey: string; href: string }[] = [
  { labelKey: 'operiaCustomers', href: '/operia/customers' },
  { labelKey: 'operiaUsers', href: '/operia/users' },
  { labelKey: 'operiaGeneral', href: '/operia/general' },
  { labelKey: 'operiaProducts', href: '/operia/products' },
  { labelKey: 'operiaHomeDesign', href: '/operia/home-design' },
  { labelKey: 'operiaHandheldDesign', href: '/operia/handheld-design' },
  { labelKey: 'operiaCarriers', href: '/operia/carriers' },
  { labelKey: 'operiaShipping', href: '/operia/shipping' },
  { labelKey: 'operiaAssets', href: '/operia/assets' },
  { labelKey: 'operiaMaps', href: '/operia/maps' },
  { labelKey: 'operiaDataTransfer', href: '/operia/data-transfer' },
  { labelKey: 'operiaBilling', href: '/operia/billing' },
  { labelKey: 'operiaApiKeys', href: '/operia/apikeys' },
  { labelKey: 'operiaIntegrations', href: '/operia/integrations' },
  { labelKey: 'operiaTemplates', href: '/operia/templates' },
  { labelKey: 'operiaLocalization', href: '/operia/localization' },
  { labelKey: 'operiaNotifications', href: '/operia/notifications' },
  { labelKey: 'operiaLogs', href: '/operia/logs' },
  { labelKey: 'operiaLogDrains', href: '/operia/log-drains' },
]

// Filtrér grupper/punkter efter brugerens adgang. Uden adgangsinfo (endnu
// ikke hentet) vises ingen grupper — så punkter ikke blinker frem og
// forsvinder igen. Home/Indstillinger står uden for grupperne og er åbne.
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

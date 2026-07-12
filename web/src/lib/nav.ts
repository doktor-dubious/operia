import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Banknote,
  Boxes,
  Building2,
  CalendarRange,
  Cog,
  Download,
  FileText,
  Handshake,
  LayoutDashboard,
  Layers,
  Lock,
  Mail,
  MapPin,
  Network,
  Package,
  PackageCheck,
  PackagePlus,
  Palette,
  Radio,
  Route,
  Settings,
  Ship,
  SlidersHorizontal,
  Tag,
  Truck,
  Upload,
  UserCog,
  Users,
} from 'lucide-react'

// Navigationsstruktur efter prototypens fulde scope (intra-app + admin-portal
// + assets-app foldet ind i én app). Grupper og punkter filtreres på adgang:
//  - requires 'manager': stamdata/system (managers + platform-admins)
//  - requires 'platform': DCA Logic-gruppen (kun platform-admins)
//  - productKey: kræver aktivt produkt for virksomheden (has_product)

export type AccessInfo = {
  isPlatformAdmin: boolean
  isManager: boolean
  products: Set<string>
}

export type NavItem = {
  labelKey: string // i18n-nøgle under nav.*
  href: string
  icon: LucideIcon
  productKey?: string
  children?: { labelKey: string; href: string }[] // undermenu (fx Import)
}

export type NavGroup = {
  labelKey: string // i18n-nøgle under nav.*
  requires?: 'manager' | 'platform'
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    labelKey: 'groupParcels',
    items: [
      { labelKey: 'dashboard', href: '/', icon: LayoutDashboard },
      { labelKey: 'parcels', href: '/parcels', icon: Package },
      { labelKey: 'receive', href: '/parcels/receive', icon: PackagePlus },
      { labelKey: 'handout', href: '/parcels/handout', icon: PackageCheck },
      { labelKey: 'reports', href: '/reports', icon: FileText },
      { labelKey: 'stats', href: '/stats', icon: Layers },
    ],
  },
  {
    labelKey: 'groupMasterData',
    requires: 'manager',
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
          { labelKey: 'importRemote', href: '/import/remote' },
          { labelKey: 'importLog', href: '/import/log' },
        ],
      },
    ],
  },
  {
    // Pakkernes egen stamdata — flyttet fra Stamdata, som nu kun er de
    // fælles registre (medarbejdere/afdelinger/skabe/import).
    labelKey: 'groupParcelManagement',
    requires: 'manager',
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
        href: '/assets/import/assets',
        icon: Upload,
        productKey: 'assets',
        children: [
          { labelKey: 'assetImportAssets', href: '/assets/import/assets' },
        ],
      },
      {
        labelKey: 'assetExport',
        href: '/assets/export/assets',
        icon: Download,
        productKey: 'assets',
        children: [
          { labelKey: 'assetExportAssets', href: '/assets/export/assets' },
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
        href: '/inventory/import/items',
        icon: Upload,
        productKey: 'lager',
        children: [{ labelKey: 'inventoryImportItems', href: '/inventory/import/items' }],
      },
      {
        labelKey: 'inventoryExport',
        href: '/inventory/export/items',
        icon: Download,
        productKey: 'lager',
        children: [{ labelKey: 'inventoryExportItems', href: '/inventory/export/items' }],
      },
    ],
  },
  {
    labelKey: 'groupSystem',
    requires: 'manager',
    items: [
      { labelKey: 'users', href: '/system/users', icon: UserCog },
      { labelKey: 'emailTemplates', href: '/system/email-templates', icon: Mail },
      { labelKey: 'labelTemplates', href: '/system/label-templates', icon: Tag },
      { labelKey: 'companySettings', href: '/system/company', icon: Building2 },
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
  {
    labelKey: 'groupPlatform',
    requires: 'platform',
    items: [
      { labelKey: 'branding', href: '/platform/branding', icon: Palette },
      { labelKey: 'billing', href: '/platform/billing', icon: Banknote },
      { labelKey: 'integrations', href: '/platform/integrations', icon: Network },
    ],
  },
]

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
  { labelKey: 'configureProducts', href: '/configure/products' },
  { labelKey: 'configureTemplates', href: '/configure/templates' },
  { labelKey: 'configureLocalization', href: '/configure/localization' },
  { labelKey: 'configureNotifications', href: '/configure/notifications' },
  { labelKey: 'configureBilling', href: '/configure/billing' },
  { labelKey: 'configureShipping', href: '/configure/shipping' },
  { labelKey: 'configureLogo', href: '/configure/logo' },
  { labelKey: 'configureAppearance', href: '/configure/appearance' },
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
  { labelKey: 'operiaProducts', href: '/operia/products' },
  { labelKey: 'operiaCarriers', href: '/operia/carriers' },
  { labelKey: 'operiaShipping', href: '/operia/shipping' },
  { labelKey: 'operiaAssets', href: '/operia/assets' },
  { labelKey: 'operiaBilling', href: '/operia/billing' },
  { labelKey: 'operiaApiKeys', href: '/operia/apikeys' },
  { labelKey: 'operiaTemplates', href: '/operia/templates' },
  { labelKey: 'operiaLocalization', href: '/operia/localization' },
  { labelKey: 'operiaNotifications', href: '/operia/notifications' },
  { labelKey: 'operiaLogs', href: '/operia/logs' },
]

// Filtrér grupper/punkter efter brugerens adgang. Uden adgangsinfo (endnu
// ikke hentet) vises kun pakkegruppen — så admin-punkter ikke blinker frem.
export function visibleNavGroups(access: AccessInfo | undefined): NavGroup[] {
  if (!access) return navGroups.filter((g) => !g.requires).slice(0, 1)
  return navGroups
    .filter((group) => {
      if (group.requires === 'platform') return access.isPlatformAdmin
      if (group.requires === 'manager') return access.isManager || access.isPlatformAdmin
      return true
    })
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          !item.productKey || access.isPlatformAdmin || access.products.has(item.productKey),
      ),
    }))
    .filter((group) => group.items.length > 0)
}

export const allNavItems = [
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

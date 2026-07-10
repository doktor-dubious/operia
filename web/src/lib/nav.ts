import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Banknote,
  Building2,
  CalendarRange,
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
  ScanLine,
  Settings,
  Ship,
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
      { labelKey: 'locations', href: '/locations', icon: MapPin },
      { labelKey: 'handlingClasses', href: '/handling-classes', icon: Handshake },
      { labelKey: 'carriers', href: '/carriers', icon: Truck },
      { labelKey: 'import', href: '/import', icon: Upload },
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
      { labelKey: 'assets', href: '/products/assets', icon: Archive, productKey: 'assets' },
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
      { labelKey: 'customers', href: '/platform/customers', icon: Building2 },
      { labelKey: 'entitlements', href: '/platform/entitlements', icon: ScanLine },
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

export const allNavItems = [...navGroups.flatMap((g) => g.items), settingsNav]

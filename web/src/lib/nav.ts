import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Boxes,
  CalendarRange,
  LayoutDashboard,
  Lock,
  MapPin,
  Package,
  Radio,
  Route,
  Settings,
  Ship,
  Users,
} from 'lucide-react'

// Fælles nav-definition for begge navigationstilstande.
// productKey-gatede punkter filtreres på company_products når entitlements
// er koblet på (has_product) — indtil da vises de som "på vej".

export type NavItem = {
  labelKey: string // i18n-nøgle under nav.*
  href: string
  icon: LucideIcon
  productKey?: string
}

export const coreNav: NavItem[] = [
  { labelKey: 'dashboard', href: '/', icon: LayoutDashboard },
  { labelKey: 'parcels', href: '/parcels', icon: Package },
  { labelKey: 'employees', href: '/employees', icon: Users },
  { labelKey: 'locations', href: '/locations', icon: MapPin },
]

export const productNav: NavItem[] = [
  { labelKey: 'assets', href: '/products/assets', icon: Archive, productKey: 'assets' },
  { labelKey: 'lockers', href: '/products/lockers', icon: Lock, productKey: 'lockers' },
  { labelKey: 'iot', href: '/products/iot', icon: Radio, productKey: 'iot' },
  { labelKey: 'shipping', href: '/products/shipping', icon: Ship, productKey: 'shipping' },
  { labelKey: 'routes', href: '/products/routes', icon: Route, productKey: 'routes' },
  { labelKey: 'booking', href: '/products/booking', icon: CalendarRange, productKey: 'booking' },
]

export const settingsNav: NavItem = {
  labelKey: 'settings',
  href: '/settings',
  icon: Settings,
}

export const allNav = [...coreNav, ...productNav, settingsNav]

export const brandIcon = Boxes

import type { Database } from '@/lib/database.types'

// Rollemodel v2 (2026-07-19): produkt-opdelte roller. En bruger kan have flere
// roller; manager har adgang til alt hos egen kunde, platform-admins til alt.
// RLS er den reelle håndhævelse — dette katalog styrer kun UI'et (nav, sider,
// forside-fliser og Adgang-fanen på brugersiderne).

export type AppRole = Database['public']['Enums']['app_role']

export type AccessInfo = {
  isPlatformAdmin: boolean
  isManager: boolean
  roles: Set<AppRole>
  products: Set<string>
}

export type RoleDef = {
  value: AppRole
  labelKey: string // i18n under usersPage.*
  descKey: string // i18n under userDetail.*
  hintKey?: string
  notDefined?: boolean // rolle uden defineret sideadgang endnu (kun forsiden)
}

export type RoleGroup = {
  labelKey: string // i18n under userDetail.roleGroup*
  roles: RoleDef[]
}

// Grupperet katalog til Adgang-fanen. final_receiver udelades bevidst
// (importerede medarbejdere uden systemadgang).
export const ROLE_GROUPS: RoleGroup[] = [
  {
    labelKey: 'userDetail.roleGroupGeneral',
    roles: [
      {
        value: 'manager',
        labelKey: 'usersPage.roleManager',
        descKey: 'userDetail.roleManagerDescription',
      },
      {
        value: 'data_manager',
        labelKey: 'usersPage.roleDataManager',
        descKey: 'userDetail.roleDataManagerDescription',
      },
    ],
  },
  {
    labelKey: 'userDetail.roleGroupParcels',
    roles: [
      {
        value: 'parcel_handler',
        labelKey: 'usersPage.roleParcelHandler',
        descKey: 'userDetail.roleParcelHandlerDescription',
      },
      {
        value: 'parcel_manager',
        labelKey: 'usersPage.roleParcelManager',
        descKey: 'userDetail.roleParcelManagerDescription',
      },
      {
        value: 'handheld_parcel_handler',
        labelKey: 'usersPage.roleHandheldParcelHandler',
        descKey: 'userDetail.roleHandheldParcelHandlerDescription',
        hintKey: 'userDetail.roleHandheldHint',
      },
    ],
  },
  {
    labelKey: 'userDetail.roleGroupAssets',
    roles: [
      {
        value: 'asset_handler',
        labelKey: 'usersPage.roleAssetHandler',
        descKey: 'userDetail.roleNotDefinedDescription',
        notDefined: true,
      },
      {
        value: 'asset_manager',
        labelKey: 'usersPage.roleAssetManager',
        descKey: 'userDetail.roleAssetManagerDescription',
      },
      {
        value: 'handheld_asset_handler',
        labelKey: 'usersPage.roleHandheldAssetHandler',
        descKey: 'userDetail.roleNotDefinedDescription',
        hintKey: 'userDetail.roleHandheldHint',
        notDefined: true,
      },
    ],
  },
  {
    labelKey: 'userDetail.roleGroupInventory',
    roles: [
      {
        value: 'inventory_handler',
        labelKey: 'usersPage.roleInventoryHandler',
        descKey: 'userDetail.roleNotDefinedDescription',
        notDefined: true,
      },
      {
        value: 'inventory_manager',
        labelKey: 'usersPage.roleInventoryManager',
        descKey: 'userDetail.roleInventoryManagerDescription',
      },
      {
        value: 'handheld_inventory_handler',
        labelKey: 'usersPage.roleHandheldInventoryHandler',
        descKey: 'userDetail.roleHandheldInventoryHandlerDescription',
        hintKey: 'userDetail.roleHandheldHint',
      },
    ],
  },
  {
    labelKey: 'userDetail.roleGroupRoutes',
    roles: [
      {
        value: 'route_planner_handler',
        labelKey: 'usersPage.roleRoutePlannerHandler',
        descKey: 'userDetail.roleNotDefinedDescription',
        notDefined: true,
      },
      {
        value: 'route_planner_manager',
        labelKey: 'usersPage.roleRoutePlannerManager',
        descKey: 'userDetail.roleRoutePlannerManagerDescription',
      },
      {
        value: 'handheld_route_planner',
        labelKey: 'usersPage.roleHandheldRoutePlanner',
        descKey: 'userDetail.roleHandheldRoutePlannerDescription',
        hintKey: 'userDetail.roleHandheldHint',
      },
    ],
  },
]

// Fladt katalog i visningsrækkefølge (manager først) — bruges til badges,
// sortering og invitationsdialogen.
export const ASSIGNABLE_ROLES: RoleDef[] = ROLE_GROUPS.flatMap((g) => g.roles)

export const roleLabelKey = Object.fromEntries(
  ASSIGNABLE_ROLES.map((r) => [r.value, r.labelKey]),
) as Record<AppRole, string>

// ---------------------------------------------------------------------------
// Sideadgang. Hver post: URL-præfiks → roller der (ud over manager og
// platform-admin) åbner siden. Tom liste = kun manager/platform-admin.
// Stier uden post (fx / og /settings) er åbne for alle der er logget ind.
// Længste matchende præfiks vinder, så /parcels/receive kan være bredere
// end /parcels.
const PAGE_ACCESS: { prefix: string; roles: AppRole[] }[] = [
  { prefix: '/parcels/receive', roles: ['parcel_handler', 'parcel_manager'] },
  { prefix: '/parcels/handout', roles: ['parcel_handler', 'parcel_manager'] },
  { prefix: '/parcels/board', roles: ['parcel_handler', 'parcel_manager'] },
  { prefix: '/parcels/condition', roles: ['parcel_handler', 'parcel_manager'] },
  { prefix: '/parcels/move', roles: ['parcel_handler', 'parcel_manager'] },
  { prefix: '/parcels/search', roles: ['parcel_handler', 'parcel_manager'] },
  { prefix: '/parcels', roles: ['parcel_manager'] },
  { prefix: '/reports', roles: ['parcel_manager'] },
  { prefix: '/stats', roles: ['parcel_manager'] },
  { prefix: '/employees', roles: ['data_manager'] },
  { prefix: '/departments', roles: ['data_manager'] },
  { prefix: '/lockers', roles: ['data_manager'] },
  { prefix: '/import', roles: ['data_manager'] },
  { prefix: '/locations', roles: [] },
  { prefix: '/handling-classes', roles: [] },
  { prefix: '/carriers', roles: [] },
  { prefix: '/assets', roles: ['asset_manager'] },
  { prefix: '/inventory', roles: ['inventory_manager'] },
  { prefix: '/products/routes', roles: ['route_planner_manager'] },
  { prefix: '/products', roles: [] },
  { prefix: '/configure', roles: [] },
]

function matchPageAccess(pathname: string): { prefix: string; roles: AppRole[] } | null {
  let best: { prefix: string; roles: AppRole[] } | null = null
  for (const entry of PAGE_ACCESS) {
    if (pathname !== entry.prefix && !pathname.startsWith(entry.prefix + '/')) continue
    if (!best || entry.prefix.length > best.prefix.length) best = entry
  }
  return best
}

// Kræver stien rolleadgang? null = åben for alle loggede ind. Bruges til at
// undgå skelet-visning på åbne sider mens adgangsinfo hentes.
export function pathIsOpen(pathname: string): boolean {
  return !pathname.startsWith('/operia') && matchPageAccess(pathname) === null
}

export function canAccessPath(pathname: string, access: AccessInfo): boolean {
  if (access.isPlatformAdmin) return true
  if (pathname.startsWith('/operia')) return false
  if (access.isManager) return true
  const entry = matchPageAccess(pathname)
  if (!entry) return true
  return entry.roles.some((r) => access.roles.has(r))
}

// Forsidens produktfliser: en flise vises kun hvis brugeren har en rolle i
// produktets sektion (manager/platform-admin ser alt med entitlement).
const SECTION_ROLES: Record<string, AppRole[]> = {
  parcels: ['parcel_handler', 'parcel_manager', 'handheld_parcel_handler'],
  assets: ['asset_handler', 'asset_manager', 'handheld_asset_handler'],
  lager: ['inventory_handler', 'inventory_manager', 'handheld_inventory_handler'],
  routes: ['route_planner_handler', 'route_planner_manager', 'handheld_route_planner'],
}

// Bedste destination for en produktflise ud fra brugerens adgang: produktets
// hovedside hvis rollen kan åbne den (managers/parcel_manager), ellers den
// første underside rollen faktisk kan åbne (fx /parcels/receive for en
// parcel_handler). Uden dette peger flisen altid på hovedsiden, som en handler
// ikke må se — så forsidens primære flise fører til "ingen adgang".
export function productTileHref(href: string, access: AccessInfo): string {
  if (canAccessPath(href, access)) return href
  const sub = PAGE_ACCESS.filter((e) => e.prefix.startsWith(href + '/')).find((e) =>
    canAccessPath(e.prefix, access),
  )
  return sub?.prefix ?? href
}

export function canSeeProductTile(product: string, href: string, access: AccessInfo): boolean {
  if (access.isPlatformAdmin || access.isManager) return true
  const roles = SECTION_ROLES[product]
  if (!roles) return false // lockers/iot/shipping/booking: kun manager indtil videre
  if (!roles.some((r) => access.roles.has(r))) return false
  // Vis kun flisen hvis den fører et sted hen, rollen faktisk kan åbne — ellers
  // er den et blindspor (fx en ren handheld_parcel_handler uden web-sider).
  return canAccessPath(productTileHref(href, access), access)
}

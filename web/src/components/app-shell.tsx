import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react'
import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { RefreshCw } from '@/components/animate-ui/icons/refresh-cw'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { CompanySwitcher } from '@/components/company-switcher'
import { FeedbackPopover } from '@/components/feedback-popover'
import { ImpersonationBanner } from '@/components/impersonation-banner'
import { UserNavDropdownContent } from '@/components/user-nav-dropdown'
import { useUiSettings } from '@/components/ui-settings-provider'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useRefreshInterval } from '@/hooks/use-platform-settings'
import { useParcelsRealtime } from '@/hooks/use-parcels-realtime'
import { useSession } from '@/hooks/use-session'
import { supabase } from '@/lib/supabase'
import {
  allNavItems,
  configureNav,
  homeNav,
  navGroups,
  operiaNav,
  simpleNavGroups,
  visibleNavGroups,
} from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useAccess } from '@/hooks/use-access'
import { BrandLogo } from '@/components/brand-logo'

// To navigationstilstande (brugervalg under Indstillinger):
//  - classic: fast sidemenu med al funktionalitet synlig, ikoner til venstre.
//  - modern:  slank skinne; al navigation i dropdown nederst til venstre
//             (compliance-circle/gorm.ai-mønsteret). Navigationskromen er
//             bevidst skarpkantet (rounded-none) som i compliance-circle.

function useUserProfile() {
  // Profilnavn fra app_users; falder tilbage til e-mailen indtil navnet
  // findes (fx hvis rækken mangler eller stadig hentes).
  const { session } = useSession()
  const { data: fullName } = useQuery({
    queryKey: ['user-profile', session?.user.id],
    enabled: !!session,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('app_users')
        .select('full_name')
        .eq('user_id', session!.user.id)
        .maybeSingle()
      return data?.full_name ?? null
    },
  })
  const name = fullName ?? session?.user.email ?? 'Operia'
  return { name, initial: name[0]?.toUpperCase() ?? 'O' }
}

function UserTrigger({
  name,
  initial,
  collapsed = false,
}: {
  name: string
  initial: string
  collapsed?: boolean
}) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        title={collapsed ? name : undefined}
        className={cn(
          'h-auto w-full cursor-pointer justify-start overflow-hidden rounded-none hover:bg-muted/80',
          collapsed ? 'px-0 py-3' : 'p-3',
        )}
      >
        <div className={cn('flex min-w-0 flex-1 items-center gap-3', collapsed && 'justify-center')}>
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-muted-foreground/20">{initial}</AvatarFallback>
          </Avatar>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-left text-xs font-medium group-data-[collapsible=icon]:hidden">
                {name}
              </span>
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
            </>
          )}
        </div>
      </Button>
    </DropdownMenuTrigger>
  )
}

// Minimér/normalisér-knappen øverst til højre i sidemenuen (claude.ai-mønsteret):
// samme lille ghost-ikonknap i begge navigationstilstande, ikonet viser hvad
// klikket gør. Genvejen ⌘/Ctrl+B gør det samme.
function NavToggle({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean
  onToggle: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const label = t(collapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar')
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(
        'h-7 w-7 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <Icon className="size-4" />
    </Button>
  )
}

// Toppen af sidemenuen: logo + navn til venstre, minimér-knappen til højre.
// Minimeret er der kun plads til ét ikon — som på claude.ai står logoet der, og
// knappen træder frem ved hover/tastaturfokus.
function BrandAndToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  if (collapsed) {
    return (
      <div className="group/brand relative mx-auto flex size-7 items-center justify-center">
        <BrandLogo className="size-5 transition-opacity group-hover/brand:opacity-0" />
        <NavToggle
          collapsed
          onToggle={onToggle}
          className="absolute inset-0 opacity-0 transition-opacity group-hover/brand:opacity-100 focus-visible:opacity-100"
        />
      </div>
    )
  }
  return (
    <>
      <BrandLogo className="h-5 w-5 shrink-0" />
      <span className="text-[13px] font-semibold">{t('app.name')}</span>
      <NavToggle collapsed={false} onToggle={onToggle} className="ml-auto" />
    </>
  )
}

// Det tomme område under menupunkterne i normal bredde: klik minimerer menuen,
// og markøren viser det (pil mod venstre) allerede ved hover. Vises kun når
// menuen er udfoldet — i minimeret tilstand er der intet tomrum at klikke på.
function CollapseZone({ onCollapse }: { onCollapse: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      aria-hidden
      title={t('nav.collapseSidebar')}
      onClick={onCollapse}
      className="min-h-8 flex-1 cursor-w-resize"
    />
  )
}

// Sidemenu-styling efter Supabase Studio: 240px bred, kompakte punkter
// (13px, vægt 500), dæmpet tekst der bliver fremhævet på hover/aktiv med
// diskret baggrunds-highlight, uppercase sektionsoverskrifter.
const menuItemClass =
  'h-7 gap-2 rounded-md px-3 text-[13px] font-medium text-muted-foreground ' +
  'hover:text-foreground data-[active=true]:text-foreground [&_svg]:size-4'

function ClassicSidebar() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { name, initial } = useUserProfile()
  const { data: access } = useAccess()
  const { companyId } = useCompanyContext()
  const { state, isMobile, toggleSidebar, setOpen } = useSidebar()
  // På mobil vises menuen som en fuld sheet — der findes ingen minimeret bredde.
  const collapsed = !isMobile && state === 'collapsed'
  const groups = visibleNavGroups(access)
  // Konfiguration: managers for egen virksomhed; platform-admins når en
  // kunde er valgt i CompanySwitcheren.
  const showConfigure = !!companyId && (access?.isManager || access?.isPlatformAdmin)

  // Undermenuer er foldet sammen som udgangspunkt; klik folder ud, og kun
  // én kan være åben ad gangen (accordion). Aktiv child-rute åbner sin forælder.
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  useEffect(() => {
    const parent = navGroups
      .flatMap((g) => g.items)
      .find((item) => item.children?.some((child) => child.href === pathname))
    if (parent) setOpenSubmenu(parent.labelKey)
  }, [pathname])

  // Grupper (Pakker, Stamdata, System, …) kan foldes op/ned ved klik på
  // overskriften. Udfoldet som udgangspunkt; valget huskes i localStorage.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem('operia-sidebar-collapsed') ?? '[]'))
    } catch {
      return new Set<string>()
    }
  })
  useEffect(() => {
    localStorage.setItem('operia-sidebar-collapsed', JSON.stringify([...collapsedGroups]))
  }, [collapsedGroups])
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <Sidebar collapsible="icon" className="select-none">
      <SidebarHeader>
        <div className={cn('flex h-10 items-center gap-2', collapsed ? 'px-0' : 'px-2')}>
          <BrandAndToggle collapsed={collapsed} onToggle={toggleSidebar} />
        </div>
      </SidebarHeader>
      <CompanySwitcher compact={collapsed} />
      <SidebarContent>
        {/* Home — øverste, selvstændige punkt med en separator under. */}
        <SidebarGroup className="pb-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === homeNav.href}
                  tooltip={t('nav.home')}
                  className={menuItemClass}
                >
                  <Link to={homeNav.href}>
                    <homeNav.icon />
                    <span>{t('nav.home')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarSeparator className="mx-3 w-auto" />
        {groups.map((group) => {
          const collapsed = collapsedGroups.has(group.labelKey)
          return (
          <SidebarGroup key={group.labelKey}>
            <SidebarGroupLabel
              asChild
              className="px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70"
            >
              <button
                type="button"
                onClick={() => toggleGroup(group.labelKey)}
                className="w-full cursor-pointer transition-colors hover:text-muted-foreground"
              >
                <span>{t(`nav.${group.labelKey}`)}</span>
                <ChevronDown
                  className={cn(
                    'ml-auto !size-3.5 transition-transform duration-200',
                    collapsed && '-rotate-90',
                  )}
                />
              </button>
            </SidebarGroupLabel>
            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-200 ease-out',
                collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
              )}
            >
              <div className="overflow-hidden">
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) =>
                  item.children ? (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        tooltip={t(`nav.${item.labelKey}`)}
                        className={cn(
                          menuItemClass,
                          'cursor-pointer',
                          // aktiv child: kun tekstfremhævning, ingen baggrund
                          item.children.some((c) => c.href === pathname) && 'text-foreground',
                        )}
                        onClick={() =>
                          setOpenSubmenu((prev) =>
                            prev === item.labelKey ? null : item.labelKey,
                          )
                        }
                      >
                        <item.icon />
                        <span>{t(`nav.${item.labelKey}`)}</span>
                        <ChevronRight
                          className={cn(
                            'ml-auto size-3.5 transition-transform duration-200',
                            openSubmenu === item.labelKey && 'rotate-90',
                          )}
                        />
                      </SidebarMenuButton>
                      {openSubmenu === item.labelKey && (
                        <SidebarMenuSub>
                          {item.children.map((child) => (
                            <SidebarMenuSubItem key={child.href}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={pathname === child.href}
                                className="h-6 text-xs text-muted-foreground hover:text-foreground data-[active=true]:text-foreground"
                              >
                                <Link to={child.href}>{t(`nav.${child.labelKey}`)}</Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      )}
                    </SidebarMenuItem>
                  ) : (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === item.href}
                        tooltip={t(`nav.${item.labelKey}`)}
                        className={menuItemClass}
                      >
                        <Link to={item.href}>
                          <item.icon />
                          <span>{t(`nav.${item.labelKey}`)}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
              </div>
            </div>
          </SidebarGroup>
          )
        })}
        {/* Tomrummet mellem menupunkterne og bundgruppen: klik minimerer. */}
        {!collapsed && <CollapseZone onCollapse={() => setOpen(false)} />}
        {/* Nederst: Konfiguration (virksomhedens egen — managers, samt
            platform-admins med valgt kunde) og Operia (kun platform-admins,
            der har adgang til alt). */}
        {(showConfigure || access?.isPlatformAdmin) && (
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {showConfigure && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(configureNav.href)}
                      tooltip={t('nav.configure')}
                      className={menuItemClass}
                    >
                      <Link to={configureNav.href}>
                        <configureNav.icon />
                        <span>{t('nav.configure')}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {access?.isPlatformAdmin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(operiaNav.href)}
                      tooltip={t('nav.operia')}
                      className={menuItemClass}
                    >
                      <Link to={operiaNav.href}>
                        <operiaNav.icon />
                        <span>{t('nav.operia')}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="p-0">
        <DropdownMenu>
          <UserTrigger name={name} initial={initial} collapsed={collapsed} />
          <UserNavDropdownContent includeNav={false} />
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

// Moderne tilstand: forenklet navigation til ikke-IT-vante brugere. Kun det
// daglige arbejde — tavle/overblik plus de fem pakkehandlinger (samme sæt som
// håndterminalens fliser) — vist som store, tydelige knapper med ikon + label.
// Resten af navigationen, inkl. pakkernes listesider (oversigt/rapporter/
// statistik) og Konfiguration/Operia, ligger i dropdownen nederst til venstre.
const bigNavItemClass =
  'flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/30 px-3 py-3 ' +
  'text-[15px] font-medium text-foreground-light transition-colors ' +
  'hover:border-foreground/20 hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-5 [&_svg]:shrink-0'

// Minimeret: kun ikonerne, centreret i en smal skinne (samme bredde som den
// klassiske ikon-tilstand). Titlen ligger i title-attributten.
const smallNavItemClass =
  'flex items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/30 py-2.5 ' +
  'text-foreground-light transition-colors hover:border-foreground/20 hover:bg-sidebar-accent ' +
  'hover:text-foreground [&_svg]:size-5 [&_svg]:shrink-0'

// Knappens standard-fremhævning når man står på siden (pakkerne og alt andet
// uden egen accent).
const activeNavItemClass = 'border-primary/40 bg-primary/10 text-foreground shadow-sm'

// Modulernes accentfarve i skinnen. Pakkerne beholder skallens grønne primær-
// look; aktiverne får et blåt anstrøg, så de to sæt store knapper kan skelnes
// på et øjeblik. Bevidst IKKE produktflisens farve fra Home-designet — den
// skifter med den valgte palet (metro/ocean/…), så der findes ingen fast
// "aktiv-farve" at spejle. Nøglen er modulets rod (stiens første segment).
// twMerge lader disse klasser vinde over basisklassens border/bg.
// `header` farver modulets fold-op/ned-overskrift, så den hører synligt sammen
// med knapperne under den.
const MODULE_ACCENT: Record<string, { idle: string; active: string; header: string }> = {
  '/assets':
    {
      idle:
        'border-sky-500/25 bg-sky-500/[0.06] hover:border-sky-500/45 hover:bg-sky-500/15 ' +
        '[&_svg]:text-sky-500/90',
      active: 'border-sky-500/50 bg-sky-500/15 text-foreground shadow-sm [&_svg]:text-sky-400',
      header: 'text-sky-500/70 hover:text-sky-400',
    },
}

// Modulet en knap hører til = stiens første segment ('/assets/board' → '/assets').
const moduleRoot = (href: string) => '/' + href.split('/')[1]

const RAIL_GROUPS_KEY = 'operia-rail-groups-collapsed'

function ModernRail() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { name, initial } = useUserProfile()
  const { data: access } = useAccess()
  const { navCollapsed, setNavCollapsed, toggleNavCollapsed } = useUiSettings()
  const groups = simpleNavGroups(access)

  // Foldede modulgrupper — samme mønster som ConfigSideNav: nøglerne på de
  // FOLDEDE grupper gemmes, så en ny gruppe (nyt modul) altid starter udfoldet.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(RAIL_GROUPS_KEY) ?? '[]'))
    } catch {
      return new Set<string>()
    }
  })
  useEffect(() => {
    localStorage.setItem(RAIL_GROUPS_KEY, JSON.stringify([...collapsedGroups]))
  }, [collapsedGroups])
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // Samme genvej som den klassiske sidemenu (SidebarProvider): ⌘/Ctrl+B.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'b' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        toggleNavCollapsed()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleNavCollapsed])

  return (
    <aside
      className={cn(
        'flex shrink-0 select-none flex-col border-r border-sidebar-border bg-sidebar',
        'transition-[width] duration-200 ease-linear',
        navCollapsed ? 'w-12' : 'w-64',
      )}
    >
      <div className={cn('flex h-10 items-center gap-2 pt-1', navCollapsed ? 'px-0' : 'px-4')}>
        <BrandAndToggle collapsed={navCollapsed} onToggle={toggleNavCollapsed} />
      </div>
      <CompanySwitcher compact={navCollapsed} />
      <nav
        className={cn(
          'flex flex-1 flex-col overflow-y-auto py-3',
          navCollapsed ? 'px-2' : 'px-3',
        )}
      >
        <div className="flex flex-col gap-2">
          {/* Home — øverst som lille link, med en separator under; de store
              knapper nedenunder er de daglige handlinger. */}
          <Link
            to={homeNav.href}
            title={t('nav.home')}
            className={cn(
              menuItemClass,
              'flex items-center hover:bg-sidebar-accent',
              navCollapsed && 'justify-center px-0',
              pathname === homeNav.href && 'bg-sidebar-accent text-foreground',
            )}
          >
            <homeNav.icon />
            {!navCollapsed && <span>{t('nav.home')}</span>}
          </Link>
          <div className="border-b border-sidebar-border" />
          {/* Ét afsnit pr. modul (pakker, aktiver, …) med egen overskrift der
              folder knapperne op/ned — samme chevron+grid-rows-mønster som
              ConfigSideNav. Moduler brugeren ikke har adgang til er allerede
              filtreret fra i simpleNavGroups, så der står aldrig en tom
              overskrift. Minimeret skinne: der er ikke plads til overskrifter,
              så grupperne vises altid udfoldet og adskilt af en streg. */}
          {groups.map((group, gi) => {
            const accent = MODULE_ACCENT[moduleRoot(group.items[0].href)]
            const isCollapsed = !navCollapsed && collapsedGroups.has(group.labelKey)
            return (
              <Fragment key={group.labelKey}>
                {navCollapsed ? (
                  gi > 0 && <div className="border-b border-sidebar-border" />
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.labelKey)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-1 px-1 pt-1 text-left',
                      'text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60',
                      'transition-colors hover:text-muted-foreground',
                      accent?.header,
                    )}
                  >
                    <span className="whitespace-nowrap">{t(`nav.${group.labelKey}`)}</span>
                    <ChevronDown
                      className={cn(
                        'ml-auto size-3.5 shrink-0 transition-transform duration-200',
                        isCollapsed && '-rotate-90',
                      )}
                    />
                  </button>
                )}
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-200 ease-out',
                    isCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="flex flex-col gap-2">
                      {group.items.map((item) => (
                        <Link
                          key={item.href}
                          to={item.href}
                          title={t(`nav.${item.labelKey}`)}
                          className={cn(
                            navCollapsed ? smallNavItemClass : bigNavItemClass,
                            accent?.idle,
                            pathname === item.href && (accent?.active ?? activeNavItemClass),
                          )}
                        >
                          <item.icon />
                          {!navCollapsed && <span>{t(`nav.${item.labelKey}`)}</span>}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </Fragment>
            )
          })}
        </div>
        {/* Tomrummet under knapperne: klik minimerer skinnen. */}
        {!navCollapsed && <CollapseZone onCollapse={() => setNavCollapsed(true)} />}
      </nav>
      <div className="border-t border-sidebar-border">
        <DropdownMenu>
          <UserTrigger name={name} initial={initial} collapsed={navCollapsed} />
          <UserNavDropdownContent includeNav />
        </DropdownMenu>
      </div>
    </aside>
  )
}

// Top/højre-området som i Supabase Studio: små ghost-ikonknapper uden kant
// (foreløbig Feedback og Søg — flere kan komme til) + brugermenuen.
function HeaderActions() {
  const { t } = useTranslation()
  const { initial } = useUserProfile()
  const queryClient = useQueryClient()
  // Auto-refresh-interval (sekunder, 0 = slået fra) fra Operia → Generelt.
  const { data: intervalSeconds } = useRefreshInterval()
  // Antal aktive forespørgsler der henter lige nu — driver spin-animationen.
  const fetching = useIsFetching() > 0
  // Lille kvitteringsbadge + ikon-highlight et øjeblik efter en refresh, så
  // brugeren ser at der sker noget (både ved klik og ved auto-refresh).
  const [pinged, setPinged] = useState(false)
  const pingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (pingTimer.current) clearTimeout(pingTimer.current)
  }, [])
  const refresh = () => {
    // Hent nye serverdata: invalidér alle forespørgsler, så aktive skærme
    // genhenter og cachen bliver frisk.
    queryClient.invalidateQueries()
    setPinged(true)
    if (pingTimer.current) clearTimeout(pingTimer.current)
    pingTimer.current = setTimeout(() => setPinged(false), 1600)
  }

  // Auto-refresh: hvert `intervalSeconds` sekund genhentes data fra databasen,
  // så fx nye pakker dukker op af sig selv. Ref'en peger altid på den seneste
  // refresh, så timeren ikke nulstilles ved hver render — kun når intervallet
  // ændres (eller slås fra med 0).
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    if (!intervalSeconds || intervalSeconds <= 0) return
    const id = setInterval(() => refreshRef.current(), intervalSeconds * 1000)
    return () => clearInterval(id)
  }, [intervalSeconds])
  return (
    <div className="ml-auto flex items-center gap-1">
      <div className="relative flex items-center">
        <AnimateIcon animate={fetching || pinged} loop={fetching} animateOnHover asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-7 w-7 cursor-pointer text-muted-foreground transition-colors hover:text-foreground',
              // Fremhæv ikonet et øjeblik når en (auto-)refresh sker.
              pinged && 'bg-accent text-foreground',
            )}
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
            onClick={refresh}
          >
            <RefreshCw className="size-4" />
          </Button>
        </AnimateIcon>
        {pinged && (
          <span className="pointer-events-none absolute left-1/2 top-full z-50 -mt-0.5 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-popover px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm animate-in fade-in slide-in-from-top-1">
            {t('common.refreshing')}
          </span>
        )}
      </div>
      <FeedbackPopover />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground"
        aria-label={t('common.search')}
        title={t('common.search')}
      >
        <Search className="size-4" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            aria-label="Menu"
          >
            <Avatar className="h-6 w-6">
              <AvatarFallback className="bg-muted-foreground/20 text-[10px]">
                {initial}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <UserNavDropdownContent includeNav={false} side="bottom" align="end" />
      </DropdownMenu>
    </div>
  )
}

function PageHeader() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active =
    allNavItems.find((item) => item.href === pathname) ??
    [...allNavItems]
      .sort((a, b) => b.href.length - a.href.length)
      .find((item) => item.href !== '/' && pathname.startsWith(item.href))
  const title = active ? t(`nav.${active.labelKey}`) : t('app.name')
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-6">
      <h1 className="text-[13px] font-semibold">{title}</h1>
      <HeaderActions />
    </header>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { navMode, navCollapsed, setNavCollapsed } = useUiSettings()
  // Realtime på pakker: håndterminalens handlinger slår igennem med det samme.
  // Ligger her i skallen (ikke på den enkelte skærm), så ét abonnement dækker
  // alle pakkeskærme — ved siden af auto-refresh'en i HeaderActions, der bliver
  // stående som fallback.
  useParcelsRealtime()

  if (navMode === 'modern') {
    return (
      <div className="flex h-svh w-full flex-col overflow-hidden">
        <ImpersonationBanner />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <ModernRail />
          <div className="flex min-w-0 flex-1 flex-col">
            <PageHeader />
            <main className="flex-1 overflow-y-auto px-6 pb-6 pt-4">{children}</main>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden">
      <ImpersonationBanner />
      {/* Minimeret/normal bredde styres af den delte UI-indstilling, så valget
          holder på tværs af sider og navigationstilstande (localStorage). */}
      <SidebarProvider
        open={!navCollapsed}
        onOpenChange={(open) => setNavCollapsed(!open)}
        className="min-h-0 flex-1"
        style={{ '--sidebar-width': '240px' } as React.CSSProperties}
      >
        <ClassicSidebar />
        <SidebarInset>
          <PageHeader />
          <main className="flex-1 overflow-y-auto px-6 pb-6 pt-4">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

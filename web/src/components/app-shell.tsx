import { useEffect, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, ChevronUp, Search } from 'lucide-react'
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
} from '@/components/ui/sidebar'
import { CompanySwitcher } from '@/components/company-switcher'
import { FeedbackPopover } from '@/components/feedback-popover'
import { UserNavDropdownContent } from '@/components/user-nav-dropdown'
import { useUiSettings } from '@/components/ui-settings-provider'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useRefreshInterval } from '@/hooks/use-platform-settings'
import { useParcelsRealtime } from '@/hooks/use-parcels-realtime'
import { useActiveAppearance } from '@/hooks/use-active-appearance'
import { useSession } from '@/hooks/use-session'
import { supabase } from '@/lib/supabase'
import {
  allNavItems,
  configureNav,
  homeNav,
  navGroups,
  operiaNav,
  simpleNavItems,
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

function UserTrigger({ name, initial }: { name: string; initial: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        className="h-auto w-full cursor-pointer justify-start overflow-hidden rounded-none p-3 hover:bg-muted/80"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-muted-foreground/20">{initial}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate text-left text-xs font-medium group-data-[collapsible=icon]:hidden">
            {name}
          </span>
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </div>
      </Button>
    </DropdownMenuTrigger>
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
        <div className="flex h-10 items-center gap-2 px-2">
          <BrandLogo className="h-5 w-5 shrink-0" />
          <span className="text-[13px] font-semibold group-data-[collapsible=icon]:hidden">
            {t('app.name')}
          </span>
        </div>
      </SidebarHeader>
      <CompanySwitcher />
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
          <UserTrigger name={name} initial={initial} />
          <UserNavDropdownContent includeNav={false} />
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

// Moderne tilstand: forenklet navigation til ikke-IT-vante brugere. Kun de fem
// daglige pakkehandlinger (samme sæt som håndterminalens fliser), vist som
// store, tydelige knapper med ikon + label. Resten af navigationen (samt
// Konfiguration/Operia) ligger i bruger-dropdownen nederst til venstre.
const bigNavItemClass =
  'flex items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/30 px-3 py-3 ' +
  'text-[15px] font-medium text-foreground-light transition-colors ' +
  'hover:border-foreground/20 hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-5 [&_svg]:shrink-0'

function ModernRail() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { name, initial } = useUserProfile()
  const { data: access } = useAccess()
  const items = simpleNavItems(access)
  return (
    <aside className="flex w-64 shrink-0 select-none flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-10 items-center gap-2 px-4 pt-1">
        <BrandLogo className="h-5 w-5 shrink-0" />
        <span className="text-[13px] font-semibold">{t('app.name')}</span>
      </div>
      <CompanySwitcher />
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-2">
          {/* Home — øverst som lille link, med en separator under; de store
              knapper nedenunder er de daglige handlinger. */}
          <Link
            to={homeNav.href}
            className={cn(
              menuItemClass,
              'flex items-center hover:bg-sidebar-accent',
              pathname === homeNav.href && 'bg-sidebar-accent text-foreground',
            )}
          >
            <homeNav.icon />
            <span>{t('nav.home')}</span>
          </Link>
          <div className="border-b border-sidebar-border" />
          {items.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                bigNavItemClass,
                pathname === item.href &&
                  'border-primary/40 bg-primary/10 text-foreground shadow-sm',
              )}
            >
              <item.icon />
              <span>{t(`nav.${item.labelKey}`)}</span>
            </Link>
          ))}
        </div>
      </nav>
      <div className="border-t border-sidebar-border">
        <DropdownMenu>
          <UserTrigger name={name} initial={initial} />
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
  const appearance = useActiveAppearance()
  const active =
    allNavItems.find((item) => item.href === pathname) ??
    [...allNavItems]
      .sort((a, b) => b.href.length - a.href.length)
      .find((item) => item.href !== '/' && pathname.startsWith(item.href))
  // Kundens white-labeling for det aktive produkt farver header-baggrunden og
  // viser logo + brand-navn; ellers falder vi tilbage til sidens nav-titel.
  const brandBg = appearance?.headerColor
  const title = appearance?.headerName || (active ? t(`nav.${active.labelKey}`) : t('app.name'))
  return (
    <header
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-6"
      style={brandBg ? { background: brandBg, color: '#fff' } : undefined}
    >
      {appearance?.logoUrl && (
        <img src={appearance.logoUrl} alt="" className="h-5 w-auto shrink-0 object-contain" />
      )}
      <h1 className="text-[13px] font-semibold">{title}</h1>
      <HeaderActions />
    </header>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { navMode } = useUiSettings()
  // Realtime på pakker: håndterminalens handlinger slår igennem med det samme.
  // Ligger her i skallen (ikke på den enkelte skærm), så ét abonnement dækker
  // alle pakkeskærme — ved siden af auto-refresh'en i HeaderActions, der bliver
  // stående som fallback.
  useParcelsRealtime()

  if (navMode === 'modern') {
    return (
      <div className="flex h-svh w-full overflow-hidden">
        <ModernRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <PageHeader />
          <main className="flex-1 overflow-y-auto px-6 pb-6 pt-4">{children}</main>
        </div>
      </div>
    )
  }

  return (
    <SidebarProvider style={{ '--sidebar-width': '240px' } as React.CSSProperties}>
      <ClassicSidebar />
      <SidebarInset>
        <PageHeader />
        <main className="flex-1 overflow-y-auto px-6 pb-6 pt-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}

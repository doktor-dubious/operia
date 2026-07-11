import { useEffect, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronUp, MessageCircle, Search } from 'lucide-react'
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
} from '@/components/ui/sidebar'
import { CompanySwitcher } from '@/components/company-switcher'
import { UserNavDropdownContent } from '@/components/user-nav-dropdown'
import { useUiSettings } from '@/components/ui-settings-provider'
import { useSession } from '@/hooks/use-session'
import { allNavItems, navGroups, settingsNav, visibleNavGroups } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useAccess } from '@/hooks/use-access'
import { BrandLogo } from '@/components/brand-logo'

// To navigationstilstande (brugervalg under Indstillinger):
//  - classic: fast sidemenu med al funktionalitet synlig, ikoner til venstre.
//  - modern:  slank skinne; al navigation i dropdown nederst til venstre
//             (compliance-circle/gorm.ai-mønsteret). Navigationskromen er
//             bevidst skarpkantet (rounded-none) som i compliance-circle.

function useUserInitial() {
  // Initial fra e-mailen i sessionen; profilnavn (app_users) kommer senere.
  const { session } = useSession()
  return session?.user.email?.[0]?.toUpperCase() ?? 'O'
}

function UserTrigger({ name }: { name: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        className="h-auto w-full cursor-pointer justify-start overflow-hidden rounded-none p-3 hover:bg-muted/80"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-muted-foreground/20">{name}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate text-left text-xs font-medium group-data-[collapsible=icon]:hidden">
            Operia
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
  const initial = useUserInitial()
  const { data: access } = useAccess()
  const groups = visibleNavGroups(access)

  // Undermenuer er foldet sammen som udgangspunkt; klik folder ud, og kun
  // én kan være åben ad gangen (accordion). Aktiv child-rute åbner sin forælder.
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  useEffect(() => {
    const parent = navGroups
      .flatMap((g) => g.items)
      .find((item) => item.children?.some((child) => child.href === pathname))
    if (parent) setOpenSubmenu(parent.labelKey)
  }, [pathname])

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
        {groups.map((group) => (
          <SidebarGroup key={group.labelKey}>
            <SidebarGroupLabel className="px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {t(`nav.${group.labelKey}`)}
            </SidebarGroupLabel>
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
          </SidebarGroup>
        ))}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === settingsNav.href}
                  tooltip={t('nav.settings')}
                  className={menuItemClass}
                >
                  <Link to={settingsNav.href}>
                    <settingsNav.icon />
                    <span>{t('nav.settings')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-0">
        <DropdownMenu>
          <UserTrigger name={initial} />
          <UserNavDropdownContent includeNav={false} />
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

function ModernRail() {
  const { t } = useTranslation()
  const initial = useUserInitial()
  return (
    <aside className="flex w-12 shrink-0 select-none flex-col border-r border-sidebar-border bg-sidebar pb-2">
      <Link to="/" aria-label={t('app.name')} className="flex justify-center p-2 pt-3">
        <BrandLogo className="h-5 w-5" />
      </Link>
      <CompanySwitcher compact />
      <div className="mt-auto flex justify-center pt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 cursor-pointer rounded-none"
              aria-label="Menu"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-muted-foreground/20">{initial}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
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
  const initial = useUserInitial()
  const queryClient = useQueryClient()
  // Antal aktive forespørgsler der henter lige nu — driver spin-animationen.
  const fetching = useIsFetching() > 0
  // Lille kvitteringsbadge under ikonet et øjeblik efter klik, så brugeren
  // ser at der sker noget.
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
  return (
    <div className="ml-auto flex items-center gap-1">
      <div className="relative flex items-center">
        <AnimateIcon animate={fetching} loop={fetching} animateOnHover asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground"
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
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground"
        aria-label={t('nav.feedback')}
        title={t('nav.feedback')}
      >
        <MessageCircle className="size-4" />
      </Button>
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
  return (
    <header className="flex h-10 shrink-0 items-center border-b border-border px-6">
      <h1 className="text-[13px] font-semibold">
        {active ? t(`nav.${active.labelKey}`) : t('app.name')}
      </h1>
      <HeaderActions />
    </header>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { navMode } = useUiSettings()

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

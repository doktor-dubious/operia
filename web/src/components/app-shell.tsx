import { Link, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronUp } from 'lucide-react'
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
  SidebarProvider,
} from '@/components/ui/sidebar'
import { UserNavDropdownContent } from '@/components/user-nav-dropdown'
import { useUiSettings } from '@/components/ui-settings-provider'
import { allNav, brandIcon as BrandIcon, coreNav, productNav, settingsNav } from '@/lib/nav'

// To navigationstilstande (brugervalg under Indstillinger):
//  - classic: fast sidemenu med al funktionalitet synlig, ikoner til venstre.
//  - modern:  slank skinne; al navigation i dropdown nederst til venstre
//             (compliance-circle/gorm.ai-mønsteret). Navigationskromen er
//             bevidst skarpkantet (rounded-none) som i compliance-circle.

function useUserInitial() {
  // Indtil app_users-profilen hentes: initial fra e-mailen i sessionens JWT.
  // Holdes simpel — profilopslag kommer med dashboardets datafase.
  return 'O'
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

function ClassicSidebar() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const initial = useUserInitial()

  const groups = [
    { labelKey: 'groupCore', items: coreNav },
    { labelKey: 'groupProducts', items: productNav },
  ]

  return (
    <Sidebar collapsible="icon" className="select-none">
      <SidebarHeader className="rounded-none">
        <div className="flex h-10 items-center gap-2 px-2">
          <BrandIcon className="h-5 w-5 shrink-0 text-primary" />
          <span className="text-sm font-semibold group-data-[collapsible=icon]:hidden">
            {t('app.name')}
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.labelKey}>
            <SidebarGroupLabel>{t(`nav.${group.labelKey}`)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
                      tooltip={t(`nav.${item.labelKey}`)}
                      className="rounded-none"
                    >
                      <Link to={item.href}>
                        <item.icon />
                        <span>{t(`nav.${item.labelKey}`)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === settingsNav.href}
                  tooltip={t('nav.settings')}
                  className="rounded-none"
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
    <aside className="flex w-12 shrink-0 select-none flex-col items-center justify-between border-r border-sidebar-border bg-sidebar py-2">
      <Link to="/" aria-label={t('app.name')} className="p-2">
        <BrandIcon className="h-5 w-5 text-primary" />
      </Link>
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
    </aside>
  )
}

function PageHeader() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active =
    allNav.find((item) => item.href === pathname) ??
    allNav.find((item) => item.href !== '/' && pathname.startsWith(item.href))
  return (
    <header className="flex h-10 shrink-0 items-center border-b border-border px-6">
      <h1 className="text-base font-semibold">
        {active ? t(`nav.${active.labelKey}`) : t('app.name')}
      </h1>
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
    <SidebarProvider>
      <ClassicSidebar />
      <SidebarInset>
        <PageHeader />
        <main className="flex-1 overflow-y-auto px-6 pb-6 pt-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}

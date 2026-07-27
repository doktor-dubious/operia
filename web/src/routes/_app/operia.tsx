import { useEffect } from 'react'
import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfigSideNav } from '@/components/config-side-nav'
import { operiaConfigSections } from '@/lib/nav'
import { useAccess } from '@/hooks/use-access'

// Operia-konfiguration (kun platform-admins) — layout à la Supabase Studios
// projektindstillinger: en sekundær venstremenu + centreret indhold i Outlet.
export const Route = createFileRoute('/_app/operia')({
  component: OperiaLayout,
})

function OperiaLayout() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: access } = useAccess()

  // Husk sidst valgte Operia-menupunkt, så /operia vender tilbage hertil.
  useEffect(() => {
    if (pathname.startsWith('/operia/')) localStorage.setItem('operia-last-path', pathname)
  }, [pathname])

  if (!access) return <Skeleton className="h-40 w-full" />
  if (!access.isPlatformAdmin) {
    return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  }

  return (
    <div className="flex min-h-full gap-8">
      <ConfigSideNav
        title={t('operiaConfig.title')}
        sectionNs="operiaConfig"
        sections={operiaConfigSections}
        storageKey="operia-config-collapsed"
      />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}

import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfigSideNav } from '@/components/config-side-nav'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { configureConfigSections } from '@/lib/nav'

// Konfiguration af virksomheden (managers; platform-admins for den valgte
// kunde) — samme layout som Operia-konfigurationen: sekundær venstremenu +
// centreret indhold i Outlet.
export const Route = createFileRoute('/_app/configure')({
  component: ConfigureLayout,
})

function ConfigureLayout() {
  const { t } = useTranslation()
  const { data: access } = useAccess()
  const { companyId } = useCompanyContext()

  if (!access) return <Skeleton className="h-40 w-full" />
  if (!companyId || !(access.isManager || access.isPlatformAdmin)) {
    return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  }

  return (
    <div className="flex min-h-full gap-8">
      <ConfigSideNav
        title={t('configureConfig.title')}
        sectionNs="configureConfig"
        sections={configureConfigSections}
        storageKey="configure-config-collapsed"
      />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}

import { Link, Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { configureConfigNav } from '@/lib/nav'
import { cn } from '@/lib/utils'

// Konfiguration af virksomheden (managers; platform-admins for den valgte
// kunde) — samme layout som Operia-konfigurationen: sekundær venstremenu +
// centreret indhold i Outlet.
export const Route = createFileRoute('/_app/configure')({
  component: ConfigureLayout,
})

function ConfigureLayout() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: access } = useAccess()
  const { companyId } = useCompanyContext()

  if (!access) return <Skeleton className="h-40 w-full" />
  if (!companyId || !(access.isManager || access.isPlatformAdmin)) {
    return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  }

  return (
    <div className="flex min-h-full gap-8">
      <aside className="w-52 shrink-0 select-none border-r border-border pr-2">
        <h2 className="px-3 pb-5 text-[13px] font-semibold">{t('configureConfig.title')}</h2>
        <nav className="flex flex-col gap-0.5">
          {configureConfigNav.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                'block rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                pathname === item.href && 'bg-accent text-foreground',
              )}
            >
              {t(`nav.${item.labelKey}`)}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}

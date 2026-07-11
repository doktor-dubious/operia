import { Link, Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { operiaConfigNav } from '@/lib/nav'
import { useAccess } from '@/hooks/use-access'
import { cn } from '@/lib/utils'

// Operia-konfiguration (kun platform-admins) — layout à la Supabase Studios
// projektindstillinger: en sekundær venstremenu + centreret indhold i Outlet.
export const Route = createFileRoute('/_app/operia')({
  component: OperiaLayout,
})

function OperiaLayout() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { data: access } = useAccess()

  if (!access) return <Skeleton className="h-40 w-full" />
  if (!access.isPlatformAdmin) {
    return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  }

  const bottomHrefs = ['/operia/billing', '/operia/logs']
  const configItems = operiaConfigNav.filter((i) => !bottomHrefs.includes(i.href))
  const billingItems = operiaConfigNav.filter((i) => i.href === '/operia/billing')
  const logsItems = operiaConfigNav.filter((i) => i.href === '/operia/logs')

  const NavLink = ({ href, labelKey }: { href: string; labelKey: string }) => (
    <Link
      to={href}
      className={cn(
        'block rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
        pathname === href && 'bg-accent text-foreground',
      )}
    >
      {t(`nav.${labelKey}`)}
    </Link>
  )

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
      {children}
    </p>
  )

  return (
    <div className="flex min-h-full gap-8">
      <aside className="w-52 shrink-0 select-none border-r border-border pr-2">
        <h2 className="px-3 pb-5 text-[13px] font-semibold">{t('operiaConfig.title')}</h2>
        <SectionLabel>{t('operiaConfig.sectionConfig')}</SectionLabel>
        <nav className="flex flex-col gap-0.5">
          {configItems.map((i) => (
            <NavLink key={i.href} href={i.href} labelKey={i.labelKey} />
          ))}
        </nav>
        <div className="pt-5">
          <SectionLabel>{t('operiaConfig.sectionBilling')}</SectionLabel>
          <nav className="flex flex-col gap-0.5">
            {billingItems.map((i) => (
              <NavLink key={i.href} href={i.href} labelKey={i.labelKey} />
            ))}
          </nav>
        </div>
        <div className="pt-5">
          <SectionLabel>{t('operiaConfig.sectionLogs')}</SectionLabel>
          <nav className="flex flex-col gap-0.5">
            {logsItems.map((i) => (
              <NavLink key={i.href} href={i.href} labelKey={i.labelKey} />
            ))}
          </nav>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}

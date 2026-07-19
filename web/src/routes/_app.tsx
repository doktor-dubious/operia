import { Navigate, Outlet, createFileRoute, useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AppShell } from '@/components/app-shell'
import { CompanyProvider } from '@/components/company-provider'
import { PreferencesSync } from '@/components/preferences-sync'
import { useAccess } from '@/hooks/use-access'
import { useSession } from '@/hooks/use-session'
import { canAccessPath, pathIsOpen } from '@/lib/roles'

// Pathless layout-route: alt under _app kræver login og får app-skallen.
export const Route = createFileRoute('/_app')({
  component: AppLayout,
})

// Central rolle-vagt: siderne under _app er kortlagt i lib/roles.ts
// (PAGE_ACCESS). RLS er den reelle håndhævelse — vagten giver bare en pæn
// "ingen adgang"-besked i stedet for tomme/fejlende sider. Åbne stier
// (forside, indstillinger) renderes straks uden at vente på adgangsinfo.
function RoleGuard({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { data: access, isError, refetch } = useAccess()
  const pathname = useLocation({ select: (l) => l.pathname })

  if (pathIsOpen(pathname)) return children
  // Adgangsinfoen kunne ikke hentes (efter retries). Vis en fejl med
  // prøv-igen frem for et evigt skelet — ellers hænger en gated side for altid
  // ved en forbigående netværksfejl.
  if (isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{t('common.error')}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          {t('errors.retry')}
        </Button>
      </div>
    )
  }
  if (!access) return <Skeleton className="h-40 w-full" />
  if (!canAccessPath(pathname, access)) {
    return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  }
  return children
}

function AppLayout() {
  const { session, loading } = useSession()

  if (loading) {
    return (
      <div className="flex h-svh items-center justify-center">
        <Skeleton className="h-8 w-40" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" />
  }

  return (
    <CompanyProvider>
      <PreferencesSync session={session} />
      <AppShell>
        <RoleGuard>
          <Outlet />
        </RoleGuard>
      </AppShell>
    </CompanyProvider>
  )
}

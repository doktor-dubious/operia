import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { AppShell } from '@/components/app-shell'
import { CompanyProvider } from '@/components/company-provider'
import { PreferencesSync } from '@/components/preferences-sync'
import { useSession } from '@/hooks/use-session'

// Pathless layout-route: alt under _app kræver login og får app-skallen.
export const Route = createFileRoute('/_app')({
  component: AppLayout,
})

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
        <Outlet />
      </AppShell>
    </CompanyProvider>
  )
}

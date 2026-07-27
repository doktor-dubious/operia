import { createFileRoute, redirect } from '@tanstack/react-router'

// /reports → /parcels/reports (siden flyttede dertil; gamle links og
// bogmærker lander stadig rigtigt)
export const Route = createFileRoute('/_app/reports')({
  beforeLoad: () => {
    throw redirect({ to: '/parcels/reports' })
  },
})

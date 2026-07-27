import { createFileRoute, redirect } from '@tanstack/react-router'

// /stats → /parcels/stats (siden flyttede dertil; gamle links og
// bogmærker lander stadig rigtigt)
export const Route = createFileRoute('/_app/stats')({
  beforeLoad: () => {
    throw redirect({ to: '/parcels/stats' })
  },
})

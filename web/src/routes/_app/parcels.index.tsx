import { createFileRoute, redirect } from '@tanstack/react-router'

// /parcels → /parcels/overview (siden flyttede dertil; gamle links, bogmærker
// og produktflisen lander stadig rigtigt)
export const Route = createFileRoute('/_app/parcels/')({
  beforeLoad: () => {
    throw redirect({ to: '/parcels/overview' })
  },
})

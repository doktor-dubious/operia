import { createFileRoute, redirect } from '@tanstack/react-router'

// /parcels/dashboard → /parcels/stats. Dashboardet er lagt sammen med
// statistiksiden til én side; denne omdirigering holder gamle links og
// bogmærker i live. (Undtagelses- og aktivitetskortene lever nu nederst på
// statistiksiden.)
export const Route = createFileRoute('/_app/parcels/dashboard')({
  beforeLoad: () => {
    throw redirect({ to: '/parcels/stats' })
  },
})

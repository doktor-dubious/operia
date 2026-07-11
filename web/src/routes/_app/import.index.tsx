import { createFileRoute, redirect } from '@tanstack/react-router'

// /import → /import/local (gamle links og bogmærker)
export const Route = createFileRoute('/_app/import/')({
  beforeLoad: () => {
    throw redirect({ to: '/import/local' })
  },
})

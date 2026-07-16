import { createFileRoute, redirect } from '@tanstack/react-router'

// /operia → sidst valgte menupunkt (husket i localStorage), ellers Kunder.
export const Route = createFileRoute('/_app/operia/')({
  beforeLoad: () => {
    const last =
      typeof localStorage !== 'undefined' ? localStorage.getItem('operia-last-path') : null
    const dest = last && last.startsWith('/operia/') ? last : '/operia/customers'
    throw redirect({ to: dest as '/operia/customers' })
  },
})

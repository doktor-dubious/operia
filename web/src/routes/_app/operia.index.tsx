import { createFileRoute, redirect } from '@tanstack/react-router'
import { operiaConfigNav } from '@/lib/nav'

// /operia → sidst valgte menupunkt (husket i localStorage), ellers Kunder.
// Valideres mod menuen: en gemt sti til en fjernet side (fx /operia/apikeys)
// ville ellers sende brugeren i not-found ved hvert klik på Operia.
export const Route = createFileRoute('/_app/operia/')({
  beforeLoad: () => {
    const last =
      typeof localStorage !== 'undefined' ? localStorage.getItem('operia-last-path') : null
    const dest =
      last && operiaConfigNav.some((i) => i.href === last) ? last : '/operia/customers'
    throw redirect({ to: dest as '/operia/customers' })
  },
})

import { createFileRoute } from '@tanstack/react-router'
import { LogDrainsManager } from '@/components/log-drains/log-drains-manager'

// Kundens egne log-drains (managers) — videresend virksomhedens audit-hændelser
// til dens eget observability-/SIEM-system (NIS2).
export const Route = createFileRoute('/_app/configure/log-drains')({
  component: () => <LogDrainsManager scope="company" />,
})

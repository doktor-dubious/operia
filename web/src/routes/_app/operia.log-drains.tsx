import { createFileRoute } from '@tanstack/react-router'
import { LogDrainsManager } from '@/components/log-drains/log-drains-manager'

// Platform-niveau log-drains (kun platform-admins) — DCA videresender alle
// tenants' audit-hændelser centralt.
export const Route = createFileRoute('/_app/operia/log-drains')({
  component: () => <LogDrainsManager scope="platform" />,
})

import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/coming-soon'

export const Route = createFileRoute('/_app/operia/integrations')({
  component: () => <ComingSoon titleKey="nav.operiaIntegrations" />,
})

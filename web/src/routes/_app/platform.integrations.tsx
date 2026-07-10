import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/coming-soon'

export const Route = createFileRoute('/_app/platform/integrations')({
  component: () => <ComingSoon titleKey="nav.integrations" />,
})

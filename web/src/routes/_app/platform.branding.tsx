import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/coming-soon'

export const Route = createFileRoute('/_app/platform/branding')({
  component: () => <ComingSoon titleKey="nav.branding" />,
})

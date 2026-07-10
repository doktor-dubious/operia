import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/coming-soon'

export const Route = createFileRoute('/_app/platform/customers')({
  component: () => <ComingSoon titleKey="nav.customers" />,
})

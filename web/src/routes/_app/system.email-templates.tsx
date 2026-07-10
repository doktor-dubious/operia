import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/coming-soon'

export const Route = createFileRoute('/_app/system/email-templates')({
  component: () => <ComingSoon titleKey="nav.emailTemplates" />,
})

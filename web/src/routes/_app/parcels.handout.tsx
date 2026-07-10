import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/coming-soon'

export const Route = createFileRoute('/_app/parcels/handout')({
  component: () => <ComingSoon titleKey="nav.handout" />,
})

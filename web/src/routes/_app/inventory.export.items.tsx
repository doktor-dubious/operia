import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/coming-soon'

// Pladsholder — lagerimport/-eksport bygges med Lager-modulet.
export const Route = createFileRoute('/_app/inventory/export/items')({
  component: () => <ComingSoon titleKey="nav.inventoryExportItems" />,
})

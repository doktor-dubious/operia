import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/coming-soon'

// Pladsholder — lagerimport/-eksport bygges med Lager-modulet.
export const Route = createFileRoute('/_app/inventory/import/items')({
  component: () => <ComingSoon titleKey="nav.inventoryImportItems" />,
})

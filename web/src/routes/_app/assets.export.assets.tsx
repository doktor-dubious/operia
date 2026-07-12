import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '@/components/coming-soon'

// Pladsholder — Aktiver-modulet er ikke bygget endnu.
export const Route = createFileRoute('/_app/assets/export/assets')({
  component: () => <ComingSoon titleKey="nav.assetExportAssets" />,
})

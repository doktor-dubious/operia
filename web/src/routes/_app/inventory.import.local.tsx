import { createFileRoute } from '@tanstack/react-router'
import { ModuleImportLocal } from '@/components/import/module-import-local'
import { MODULE_SPECS } from '@/lib/module-import'

export const Route = createFileRoute('/_app/inventory/import/local')({
  component: () => <ModuleImportLocal spec={MODULE_SPECS.inventory} />,
})

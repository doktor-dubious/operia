import { createFileRoute } from '@tanstack/react-router'
import { ModuleImportConfig } from '@/components/import/module-import-config'
import { MODULE_SPECS } from '@/lib/module-import'

export const Route = createFileRoute('/_app/inventory/import/config')({
  component: () => <ModuleImportConfig spec={MODULE_SPECS.inventory} />,
})

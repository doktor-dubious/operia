import { createFileRoute } from '@tanstack/react-router'
import { ModuleImportLog } from '@/components/import/module-import-log'
import { MODULE_SPECS } from '@/lib/module-import'

export const Route = createFileRoute('/_app/assets/import/log')({
  component: () => <ModuleImportLog spec={MODULE_SPECS.assets} />,
})

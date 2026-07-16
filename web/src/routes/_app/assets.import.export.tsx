import { createFileRoute } from '@tanstack/react-router'
import { ModuleExport } from '@/components/import/module-export'
import { MODULE_SPECS } from '@/lib/module-import'

export const Route = createFileRoute('/_app/assets/import/export')({
  component: () => <ModuleExport spec={MODULE_SPECS.assets} />,
})

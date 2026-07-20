import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { OperiaPage } from '@/components/operia-config-page'
import { CompanyEntraFields } from '@/components/company-entra-fields'
import { useCompanyContext } from '@/hooks/use-company-context'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Konfigurér → Integrationer: kundens egne integrationer. Vælgeren viser kun
// integrationer platformen udbyder (Operia → Integrationer), så en kunde aldrig
// kan konfigurere noget DCA ikke har slået til.
export const Route = createFileRoute('/_app/configure/integrations')({
  component: Page,
})

function Page() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data: platform, isPending } = usePlatformSettings()
  const [selected, setSelected] = useState('entra')

  const available = platform?.entra_enabled
    ? [{ key: 'entra', labelKey: 'integrationsPage.entra' }]
    : []

  return (
    <OperiaPage title={t('nav.configureIntegrations')} subtitle={t('companyEntra.subtitle')}>
      {isPending || !companyId ? (
        <Skeleton className="h-40 w-full" />
      ) : available.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('companyEntra.noneOffered')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex max-w-xl flex-col gap-2">
            <Label className="text-label">{t('integrationsPage.integration')}</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {available.map((i) => (
                  <SelectItem key={i.key} value={i.key}>
                    {t(i.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected === 'entra' && <CompanyEntraFields companyId={companyId} />}
        </div>
      )}
    </OperiaPage>
  )
}

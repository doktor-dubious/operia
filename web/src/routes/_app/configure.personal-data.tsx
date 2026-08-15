import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { OperiaPage } from '@/components/operia-config-page'
import { CompanyRetentionFields } from '@/components/retention-fields'
import { CompanySarExport } from '@/components/company-sar-export'
import { useCompanyContext } from '@/hooks/use-company-context'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'

// Konfigurér → Persondata: de to ting kunden som DATAANSVARLIG selv skal kunne
// gøre uden at ringe til DCA — bestemme hvor længe data gemmes
// (art. 5(1)(e)), og finde alt om én person når nogen beder om indsigt
// (art. 15). Kontakter og databehandleraftale ligger på nabosiden
// (Databeskyttelse).
export const Route = createFileRoute('/_app/configure/personal-data')({
  component: Page,
})

const TABS = ['retention', 'sar'] as const

function Page() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const [tab, setTab] = useState<(typeof TABS)[number]>('retention')

  return (
    <OperiaPage title={t('nav.configurePersonalData')} subtitle={t('personalData.subtitle')}>
      {!companyId ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex max-w-xl flex-col gap-2">
            <Label className="text-label">{t('personalData.area')}</Label>
            <Select value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TABS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(`personalData.${key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {tab === 'retention' && <CompanyRetentionFields companyId={companyId} />}
          {tab === 'sar' && <CompanySarExport companyId={companyId} />}
        </div>
      )}
    </OperiaPage>
  )
}

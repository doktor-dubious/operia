import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { OperiaPage } from '@/components/operia-config-page'
import { CompanyDataTransferFields } from '@/components/company-data-transfer-fields'
import { useCompanyContext } from '@/hooks/use-company-context'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_app/configure/data-transfer')({
  component: Page,
})

function Page() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  return (
    <OperiaPage title={t('nav.configureDataTransfer')} subtitle={t('companyDataTransfer.subtitle')}>
      {companyId ? (
        <CompanyDataTransferFields companyId={companyId} />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </OperiaPage>
  )
}

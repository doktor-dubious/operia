import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { OperiaPage } from '@/components/operia-config-page'
import { ProductAppearanceList } from '@/components/product-appearance-fields'
import { useCompanyContext } from '@/hooks/use-company-context'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_app/configure/appearance')({
  component: Page,
})

function Page() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  return (
    <OperiaPage title={t('nav.configureAppearance')} subtitle={t('appearance.subtitle')}>
      {companyId ? (
        <ProductAppearanceList companyId={companyId} />
      ) : (
        <Skeleton className="h-40 w-full" />
      )}
    </OperiaPage>
  )
}

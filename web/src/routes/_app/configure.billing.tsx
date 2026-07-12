import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { OperiaPage } from '@/components/operia-config-page'

export const Route = createFileRoute('/_app/configure/billing')({
  component: Page,
})

function Page() {
  const { t } = useTranslation()
  return (
    <OperiaPage title={t('nav.configureBilling')}>
      <p className="text-sm text-muted-foreground">{t('common.comingSoon')}</p>
    </OperiaPage>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { OperiaPage } from '@/components/operia-config-page'

export const Route = createFileRoute('/_app/operia/apikeys')({
  component: Page,
})

function Page() {
  const { t } = useTranslation()
  return (
    <OperiaPage title={t('nav.operiaApiKeys')}>
      <p className="text-sm text-muted-foreground">{t('common.comingSoon')}</p>
    </OperiaPage>
  )
}

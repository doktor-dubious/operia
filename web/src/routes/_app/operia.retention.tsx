import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { OperiaPage } from '@/components/operia-config-page'
import { PlatformRetentionFields } from '@/components/retention-fields'

// Operia → Opbevaring: DCA's standardperioder. De gælder kun for kunder der
// ikke selv har sat noget under Konfigurér → Persondata — opbevaringsperioden
// er den dataansvarliges beslutning, og platformen leverer alene et
// udgangspunkt.
export const Route = createFileRoute('/_app/operia/retention')({
  component: Page,
})

function Page() {
  const { t } = useTranslation()
  return (
    <OperiaPage title={t('nav.operiaRetention')} subtitle={t('retention.platformSubtitle')}>
      <PlatformRetentionFields />
    </OperiaPage>
  )
}

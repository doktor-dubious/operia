import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { OperiaPage } from '@/components/operia-config-page'
import { CompanyPrivacyFields } from '@/components/company-privacy-fields'
import { useCompanyContext } from '@/hooks/use-company-context'
import { Skeleton } from '@/components/ui/skeleton'

// Konfigurér → Databeskyttelse: kundens GDPR-kontakter og status på
// databehandleraftalen. Kunden er dataansvarlig, DCA databehandler — det er
// derfor kunden der udpeger, hvem DCA skal varsle om nye underdatabehandlere
// og underrette ved et sikkerhedsbrud. Siden er også pladsen, den kommende
// "Data & privatliv"-side vokser ud fra (underdatabehandlerliste,
// opbevaringsperioder, link til aftalen).
export const Route = createFileRoute('/_app/configure/privacy')({
  component: Page,
})

function Page() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()

  return (
    <OperiaPage title={t('nav.configurePrivacy')} subtitle={t('companyPrivacy.subtitle')}>
      {!companyId ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <CompanyPrivacyFields companyId={companyId} />
      )}
    </OperiaPage>
  )
}

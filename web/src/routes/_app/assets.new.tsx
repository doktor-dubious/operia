import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NewAssetForm, useAssetPickers } from '@/components/new-asset-form'
import { useCompanyContext } from '@/hooks/use-company-context'

// Nyt aktiv som selvstændig side — samme formular som dialogen på Aktiver, men
// uden at skulle finde ind i registret først (den daglige vej fra sidemenuen).
export const Route = createFileRoute('/_app/assets/new')({
  component: NewAssetPage,
})

function NewAssetPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { companyId } = useCompanyContext()
  const { data: pickers } = useAssetPickers(companyId)
  // Når brugeren er færdig, nulstilles formularen (ny nøgle → ny montering →
  // nyt Aktiv-nr.), så flere aktiver kan oprettes i træk uden at forlade siden.
  const [formKey, setFormKey] = useState(0)

  // "Gå til aktivet" fra konfliktdialogen: åbn registret MED aktivet valgt
  // (?id= åbner detaljepanelet), som når dialogen vises på selve Aktiver-siden.
  const showAsset = (id: string) => navigate({ to: '/assets', search: { id } })

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <Card className="w-full max-w-2xl bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('assetsPage.newTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <NewAssetForm
            key={formKey}
            companyId={companyId}
            categories={pickers?.categories ?? []}
            locations={pickers?.locations ?? []}
            scanEnabled
            finishLabel={t('assetsPage.newPageDone')}
            onCreated={() => {}}
            onFinish={() => setFormKey((n) => n + 1)}
            onShowAsset={showAsset}
          />
        </CardContent>
      </Card>
    </div>
  )
}

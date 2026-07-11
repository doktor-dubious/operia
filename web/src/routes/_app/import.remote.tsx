import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Fjernfiler: SFTP/e-mail-pipelinen fra Flow 0-roadmappet (senere fase —
// kræver en komponent uden for Supabase). Samme validering/upsert som
// Lokale filer; kørsler lander i samme log.
export const Route = createFileRoute('/_app/import/remote')({
  component: RemoteImportPage,
})

function RemoteImportPage() {
  const { t } = useTranslation()
  return (
    <Card className="max-w-lg bg-panel">
      <CardHeader>
        <CardTitle className="text-base">{t('importPage.remoteTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t('importPage.remoteBody')}</p>
      </CardContent>
    </Card>
  )
}

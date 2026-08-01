import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AssetDocumentList } from '@/components/asset-condition'
import { AssetLookupCard } from '@/components/asset-lookup-card'
import { PhotoCapture } from '@/components/photo-capture'
import { useCompanyContext } from '@/hooks/use-company-context'
import { invalidateAssetQueries, type AssetHit } from '@/lib/asset-lookup'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/assets/document')({
  component: DocumentPage,
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' && search.code ? search.code : undefined,
  }),
})

// Dokumentér: vedhæft fotos og/eller noter til et EKSISTERENDE aktiv —
// aktivernes modstykke til pakkernes Tilstand-side. Hver post er append-only
// bevismateriale og logges i aktivets historik ('documented'). Bevidst uden
// statusfilter: også et udfaset aktiv kan have brug for dokumentation.

function DocumentPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { companyId } = useCompanyContext()
  const { code } = Route.useSearch()

  const [asset, setAsset] = useState<AssetHit | null>(null)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)

  // Foto ELLER note — aldrig en helt tom post (spejler DB-checket).
  const canSubmit = !!asset && (!!photo || !!note.trim()) && !busy

  const save = async () => {
    if (!asset || !companyId || !canSubmit) return
    setBusy(true)
    try {
      let path: string | null = null
      if (photo) {
        path = `${companyId}/${asset.id}/${Date.now()}.jpg`
        const { error: uploadError } = await supabase.storage
          .from('asset-photos')
          .upload(path, photo, { contentType: 'image/jpeg' })
        if (uploadError) throw uploadError
      }
      const { error } = await supabase.from('asset_documents').insert({
        asset_id: asset.id,
        company_id: companyId,
        storage_path: path,
        note: note.trim() || null,
      })
      if (error) throw error

      invalidateAssetQueries(queryClient)
      toast.success(t('assetFlow.documentSaved'))
      setNote('')
      setPhoto(null)
    } catch (error) {
      console.error('Dokumentation fejlede:', error)
      toast.error(describeError(error as { message?: string }, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <Card className="w-full max-w-2xl bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('nav.assetDocument')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AssetLookupCard
            asset={asset}
            onAsset={(a) => {
              setAsset(a)
              setNote('')
              setPhoto(null)
            }}
            initialCode={code}
          />

          {asset && (
            <>
              <div className="flex flex-col gap-2">
                <Label>{t('receive.photo')}</Label>
                <PhotoCapture photo={photo} onPhoto={setPhoto} />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="doc-note">{t('assetFlow.note')}</Label>
                <Textarea
                  id="doc-note"
                  value={note}
                  rows={2}
                  placeholder={t('assetFlow.documentNotePlaceholder')}
                  onChange={(e) => setNote(e.target.value)}
                />
                {!photo && !note.trim() && (
                  <p className="text-xs text-muted-foreground">{t('assetFlow.documentHint')}</p>
                )}
              </div>

              <div className="flex justify-end">
                <Button type="button" disabled={!canSubmit} onClick={save}>
                  {busy ? t('common.loading') : t('assetFlow.documentAdd')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {asset && (
        <Card className="w-full max-w-md self-start bg-panel">
          <CardHeader>
            <CardTitle className="text-base">{t('assetFlow.documents')}</CardTitle>
          </CardHeader>
          <CardContent>
            <AssetDocumentList assetId={asset.id} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

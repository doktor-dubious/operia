import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AssetLookupCard } from '@/components/asset-lookup-card'
import { PhotoCapture } from '@/components/photo-capture'
import { useCompanyContext } from '@/hooks/use-company-context'
import { assetRpcErrorKey, invalidateAssetQueries, type AssetHit } from '@/lib/asset-lookup'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/assets/checkin')({
  component: CheckinPage,
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' && search.code ? search.code : undefined,
  }),
})

// Tjek ind: aktivet er tilbage på lager. Dækker alle tre udveje — tildelt,
// udlånt (lånet lukkes; låneren anonymiseres automatisk) og til service.
// Valgfrit registreres ny placering, opdateret stand og et foto af standen
// (fotoet gemmes som dokumentation med noten, så skader har bevis fra
// afleveringsøjeblikket). RPC checkin_asset skriver hændelsen.

const NONE = '__none__'

function useLocations(companyId: string | null) {
  return useQuery({
    queryKey: ['asset-pickers', 'locations', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_locations')
        .select('id, name')
        .eq('company_id', companyId!)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function CheckinPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { companyId } = useCompanyContext()
  const { code } = Route.useSearch()
  const { data: locations } = useLocations(companyId)

  const [asset, setAsset] = useState<AssetHit | null>(null)
  const [locationId, setLocationId] = useState<string>(NONE)
  const [condition, setCondition] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setLocationId(NONE)
    setCondition('')
    setNote('')
    setPhoto(null)
  }

  const notOut = !!asset && !['assigned', 'on_loan', 'service'].includes(asset.status)

  const submit = async () => {
    if (!asset || !companyId || busy) return
    setBusy(true)
    try {
      // Med foto hører noten til fotodokumentet — ellers gemmer RPC'en den.
      const { error } = await supabase.rpc('checkin_asset', {
        p_asset_id: asset.id,
        p_location_id: locationId === NONE ? undefined : locationId,
        p_condition: condition.trim() || undefined,
        p_note: photo ? undefined : note.trim() || undefined,
      })
      if (error) {
        console.error('Tjek ind fejlede:', error)
        const key = assetRpcErrorKey(error)
        toast.error(key ? t(key) : describeError(error, t))
        return
      }

      // Herfra ER aktivet tjekket ind (RPC'en er gennemført) — fejler foto-
      // dokumentationen bagefter, må det ikke ligne et fejlet tjek-ind:
      // formularen ville så stadig vise aktivet som ude, og et nyt forsøg
      // ville blot give en forvirrende asset_not_out-fejl. I stedet meldes
      // dokumentationen som det der mangler (tilføjes igen under Dokumentér).
      let documentationFailed = false
      if (photo) {
        try {
          const path = `${companyId}/${asset.id}/${Date.now()}.jpg`
          const { error: uploadError } = await supabase.storage
            .from('asset-photos')
            .upload(path, photo, { contentType: 'image/jpeg' })
          if (uploadError) throw uploadError
          const { error: docError } = await supabase.from('asset_documents').insert({
            asset_id: asset.id,
            company_id: companyId,
            storage_path: path,
            note: note.trim() || null,
          })
          if (docError) throw docError
        } catch (docErrorAny) {
          console.error('Tjek ind: dokumentationen kunne ikke gemmes:', docErrorAny)
          documentationFailed = true
        }
      }

      if (documentationFailed) {
        toast.warning(t('assetFlow.checkinDocFailed', { name: asset.name }))
      } else {
        toast.success(t('assetFlow.checkedInToast', { name: asset.name }))
      }
      invalidateAssetQueries(queryClient)
      reset()
      setAsset(null)
    } catch (error) {
      console.error('Tjek ind fejlede:', error)
      toast.error(describeError(error as { message?: string }, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <Card className="w-full max-w-2xl bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('nav.assetCheckin')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AssetLookupCard
            asset={asset}
            onAsset={(a) => {
              setAsset(a)
              reset()
            }}
            initialCode={code}
          />

          {notOut && (
            <p className="text-xs text-status-neutral-to-bad">{t('assetFlow.errAssetNotOut')}</p>
          )}

          {asset && !notOut && (
            <>
              <div className="flex flex-col gap-2">
                <Label>{t('assetFlow.checkinLocation')}</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('assetFlow.checkinKeepLocation')}</SelectItem>
                    {(locations ?? []).map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="checkin-condition">{t('assetsPage.condition')}</Label>
                <Input
                  id="checkin-condition"
                  value={condition}
                  placeholder={asset.condition ?? t('assetFlow.conditionPlaceholder')}
                  onChange={(e) => setCondition(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>{t('receive.photo')}</Label>
                <PhotoCapture photo={photo} onPhoto={setPhoto} />
                {!photo && (
                  <p className="text-xs text-muted-foreground">{t('assetFlow.checkinPhotoHint')}</p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="checkin-note">{t('assetFlow.note')}</Label>
                <Textarea
                  id="checkin-note"
                  value={note}
                  rows={2}
                  placeholder={t('assetFlow.notePlaceholder')}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="flex justify-end">
                <Button type="button" disabled={busy} onClick={submit}>
                  {busy ? t('common.loading') : t('assetFlow.checkinConfirm')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

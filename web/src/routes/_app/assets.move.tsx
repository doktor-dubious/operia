import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { useCompanyContext } from '@/hooks/use-company-context'
import { assetRpcErrorKey, invalidateAssetQueries, type AssetHit } from '@/lib/asset-lookup'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/assets/move')({
  component: MovePage,
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' && search.code ? search.code : undefined,
  }),
})

// Flyt: aktivet får en ny placering — status uændret (aktivernes modstykke til
// Flow 2). Udlånte aktiver kan ikke flyttes (de er fysisk ude af huset). RPC
// move_asset skriver hændelsen med fra/til-placering.

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

function MovePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { companyId } = useCompanyContext()
  const { code } = Route.useSearch()
  const { data: locations } = useLocations(companyId)

  const [asset, setAsset] = useState<AssetHit | null>(null)
  const [locationId, setLocationId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Udlånte og afskrevne aktiver er fysisk ude af huset og kan ikke flyttes.
  const blockedKey =
    asset?.status === 'on_loan'
      ? 'assetFlow.errAssetOnLoan'
      : asset?.status === 'written_off'
        ? 'assetFlow.errAssetWrittenOff'
        : null
  const targets = (locations ?? []).filter((l) => l.id !== asset?.location_id)
  const canSubmit = !!asset && !blockedKey && !!locationId && !busy

  const submit = async () => {
    if (!asset || !canSubmit) return
    setBusy(true)
    const { error } = await supabase.rpc('move_asset', {
      p_asset_id: asset.id,
      p_location_id: locationId,
      p_note: note.trim() || undefined,
    })
    setBusy(false)
    if (error) {
      console.error('Flytning fejlede:', error)
      const key = assetRpcErrorKey(error)
      toast.error(key ? t(key) : describeError(error, t))
      return
    }
    const toName = locations?.find((l) => l.id === locationId)?.name ?? ''
    toast.success(t('assetFlow.movedToast', { name: asset.name, to: toName }))
    invalidateAssetQueries(queryClient)
    setLocationId('')
    setNote('')
    setAsset(null)
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <Card className="w-full max-w-2xl bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('nav.assetMove')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AssetLookupCard
            asset={asset}
            onAsset={(a) => {
              setAsset(a)
              setLocationId('')
              setNote('')
            }}
            initialCode={code}
          />

          {blockedKey && <p className="text-xs text-status-neutral-to-bad">{t(blockedKey)}</p>}

          {asset && !blockedKey && (
            <>
              <div className="flex flex-col gap-2">
                <Label>{t('assetFlow.moveTarget')} *</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('assetFlow.moveTargetPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {targets.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t('assetFlow.moveNoTargets')}</p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="move-note">{t('assetFlow.note')}</Label>
                <Textarea
                  id="move-note"
                  value={note}
                  rows={2}
                  placeholder={t('assetFlow.notePlaceholder')}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="flex justify-end">
                <Button type="button" disabled={!canSubmit} onClick={submit}>
                  {busy ? t('common.loading') : t('assetFlow.moveConfirm')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

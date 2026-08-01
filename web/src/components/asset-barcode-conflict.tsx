import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AssetStatusBadge, type AssetStatus } from '@/components/asset-status-badge'
import { normalizeScan } from '@/hooks/use-barcode-scanner'
import { supabase } from '@/lib/supabase'

// Stregkode-sammenstød opdaget MENS der tastes/scannes — ikke først ved gem.
// Unik-reglen er den partielle (assets_company_barcode_active_uniq): kun
// aktiver med status uden for ('retired','written_off') tæller, så et udfaset
// eller afskrevet aktivs kode må genbruges (labelen genbruges på erstatningen).
// Bruges af detaljepanelet og "+ Ny"-dialogen på /assets.

export type BarcodeConflict = {
  id: string
  name: string
  asset_tag: string | null
  status: AssetStatus
}

/** Slår (debounced) op om en anden AKTIV bruger stregkoden. null = fri. */
export function useAssetBarcodeConflict(
  companyId: string | null,
  rawBarcode: string,
  excludeId?: string,
) {
  const code = normalizeScan(rawBarcode)
  // Debounce: opslag først når der har været tastero i 300 ms — en scanning
  // lander som én værdi og slås dermed op med det samme.
  const [debounced, setDebounced] = useState(code)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(code), 300)
    return () => window.clearTimeout(timer)
  }, [code])

  const query = useQuery({
    queryKey: ['asset-barcode-conflict', companyId, debounced, excludeId ?? null],
    enabled: !!companyId && !!debounced,
    queryFn: async (): Promise<BarcodeConflict | null> => {
      let q = supabase
        .from('assets')
        .select('id, name, asset_tag, status')
        .eq('company_id', companyId!)
        .eq('barcode', debounced)
        // Samme prædikat som det partielle unik-indeks — ellers spærrer
        // klienten en kode databasen ville acceptere.
        .not('status', 'in', '(retired,written_off)')
        .limit(1)
      if (excludeId) q = q.neq('id', excludeId)
      const { data, error } = await q.maybeSingle()
      if (error) throw error
      return (data as BarcodeConflict | null) ?? null
    },
  })

  // Konflikten gælder kun den værdi der faktisk står i feltet — ikke en
  // forsinket forespørgsel for en tidligere værdi.
  const conflict = debounced === code ? (query.data ?? null) : null
  return { conflict, code }
}

/** Popup: stregkoden er i brug — gå til aktivet der har den, eller ret koden. */
export function BarcodeConflictDialog({
  open,
  onOpenChange,
  code,
  conflict,
  onGoToAsset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  code: string
  conflict: BarcodeConflict | null
  onGoToAsset: (assetId: string) => void
}) {
  const { t } = useTranslation()
  if (!conflict) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assetsPage.barcodeConflictTitle')}</DialogTitle>
          <DialogDescription>
            {t('assetsPage.barcodeConflictBody', { code })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3 rounded-md border bg-background/50 p-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-medium">{conflict.name}</span>
            {conflict.asset_tag && (
              <span className="font-mono text-xs text-muted-foreground">{conflict.asset_tag}</span>
            )}
          </div>
          <AssetStatusBadge status={conflict.status} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('assetsPage.barcodeConflictKeep')}
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false)
              onGoToAsset(conflict.id)
            }}
          >
            {t('assetsPage.barcodeConflictGoTo')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

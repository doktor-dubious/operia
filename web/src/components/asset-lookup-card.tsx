import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AssetStatusBadge } from '@/components/asset-status-badge'
import { ScannerIndicator } from '@/components/scanner-indicator'
import { normalizeScan, useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import { useCompanyContext } from '@/hooks/use-company-context'
import { findAssetsByCode, type AssetHit } from '@/lib/asset-lookup'
import { describeError } from '@/lib/errors'

// Fælles opslagsblok for aktiv-flowsiderne: scan/indtast stregkode, serienr.
// eller aktiv-nr. → aktivet vises. Flere træffere (serienumre er ikke
// garanteret unikke) giver en flertydighedsliste i stedet for en antagelse.
// ?code=-prefill følger samme run-once-mønster som pakkesiderne.

export function AssetLookupCard({
  asset,
  onAsset,
  initialCode,
}: {
  asset: AssetHit | null
  onAsset: (asset: AssetHit | null) => void
  initialCode?: string
}) {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const [lookup, setLookup] = useState('')
  const [hits, setHits] = useState<AssetHit[]>([])
  const [notFound, setNotFound] = useState(false)
  const [scanSignal, setScanSignal] = useState(0)
  const lookupRef = useRef<HTMLInputElement>(null)

  const search = async (term?: string) => {
    const q = normalizeScan(term ?? lookup)
    if (!q || !companyId) return
    setNotFound(false)
    setHits([])
    onAsset(null)
    try {
      const found = await findAssetsByCode(companyId, q)
      if (found.length === 0) {
        setNotFound(true)
      } else if (found.length === 1) {
        onAsset(found[0])
      } else {
        setHits(found)
      }
    } catch (error) {
      console.error('Aktivopslag fejlede:', error)
      toast.error(describeError(error as { message?: string }, t))
    }
  }

  useBarcodeScanner({
    targetRef: lookupRef,
    onScan: (code) => {
      setLookup(code)
      setScanSignal((n) => n + 1)
      search(code)
    },
  })

  const prefilled = useRef<string | null>(null)
  useEffect(() => {
    if (!initialCode || !companyId || prefilled.current === initialCode) return
    prefilled.current = initialCode
    setLookup(initialCode)
    search(initialCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode, companyId])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="asset-lookup">{t('assetFlow.lookup')}</Label>
          <ScannerIndicator signal={scanSignal} />
        </div>
        <div className="flex gap-2">
          <Input
            id="asset-lookup"
            ref={lookupRef}
            value={lookup}
            autoFocus
            autoComplete="off"
            placeholder={t('assetFlow.lookupPlaceholder')}
            onChange={(e) => setLookup(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                search()
              }
            }}
          />
          <Button type="button" variant="outline" onClick={() => search()}>
            <Search className="size-4" /> {t('common.search')}
          </Button>
        </div>
        {notFound && <p className="text-xs text-status-neutral-to-bad">{t('assetFlow.notFound')}</p>}
      </div>

      {/* Flertydighed: vælg det rigtige aktiv. */}
      {hits.length > 1 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t('assetFlow.multipleMatches')}</p>
          {hits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onClick={() => {
                setHits([])
                onAsset(hit)
              }}
              className="flex items-center justify-between gap-3 rounded-md border bg-background/50 p-3 text-left transition-colors hover:bg-accent/40"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium">{hit.name}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {[hit.asset_tag, hit.serial_no].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
              <AssetStatusBadge status={hit.status} />
            </button>
          ))}
        </div>
      )}

      {/* Det fundne aktiv — kompakt kort; flowsiderne viser felterne under. */}
      {asset && (
        <div className="rounded-md border bg-background/50 p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="truncate text-[13px] font-medium">{asset.name}</span>
            <AssetStatusBadge status={asset.status} />
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">{t('assetsPage.tag')}</dt>
            <dd className="font-mono">{asset.asset_tag ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('assetsPage.serialNo')}</dt>
            <dd className="font-mono">{asset.serial_no ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('assetsPage.category')}</dt>
            <dd>{asset.category?.name ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('assetsPage.location')}</dt>
            <dd>{asset.location?.name ?? '—'}</dd>
            {asset.assigned && (
              <>
                <dt className="text-muted-foreground">{t('assetFlow.assignedTo')}</dt>
                <dd>{asset.assigned.full_name}</dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  )
}

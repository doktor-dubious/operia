import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AssetHistory } from '@/components/asset-history'
import { AssetSummary } from '@/components/asset-summary'
import { ScannerIndicator } from '@/components/scanner-indicator'
import { normalizeScan, useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import { useCompanyContext } from '@/hooks/use-company-context'
import { findAssetsByCode, type AssetHit } from '@/lib/asset-lookup'
import { describeError } from '@/lib/errors'

export const Route = createFileRoute('/_app/assets/search')({
  component: SearchPage,
})

// Søg aktiver: chain-of-custody-opslag på stregkode, serienr., aktiv-nr. eller
// navn (delvis match). Hvert hit vises som aktivets visitkort med
// hurtig-handlinger og en udfoldelig hændelseshistorik.

function SearchPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const [lookup, setLookup] = useState('')
  const [results, setResults] = useState<AssetHit[] | null>(null)
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set())
  const [scanSignal, setScanSignal] = useState(0)
  const lookupRef = useRef<HTMLInputElement>(null)

  // Termen bag de VISTE resultater — ikke feltets aktuelle indhold. Bruges af
  // refresh(), så en genindlæsning efter en handling opdaterer de kort der
  // står på skærmen, selv om brugeren imens har tastet videre i (eller ryddet)
  // søgefeltet.
  const resultsTerm = useRef('')

  const search = async (term?: string) => {
    const q = normalizeScan(term ?? lookup)
    if (!q || !companyId) return
    setOpenHistory(new Set())
    try {
      const found = await findAssetsByCode(companyId, q, { includeNameSearch: true })
      resultsTerm.current = q
      setResults(found)
    } catch (error) {
      console.error('Aktivsøgning fejlede:', error)
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

  // Efter en handling (service/udfas/…) genkøres søgningen, så kortene ikke
  // viser en forældet status — med termen der frembragte kortene.
  const refresh = () => {
    if (results?.length && resultsTerm.current) void search(resultsTerm.current)
  }

  const toggleHistory = (id: string) =>
    setOpenHistory((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full max-w-2xl bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('nav.assetSearch')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="asset-search">{t('assetFlow.lookup')}</Label>
              <ScannerIndicator signal={scanSignal} />
            </div>
            <div className="flex gap-2">
              <Input
                id="asset-search"
                ref={lookupRef}
                value={lookup}
                autoFocus
                autoComplete="off"
                placeholder={t('assetFlow.searchPlaceholder')}
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
            {results?.length === 0 && (
              <p className="text-xs text-status-neutral-to-bad">{t('assetFlow.notFound')}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {(results?.length ?? 0) > 0 && (
        <div className="flex w-full max-w-2xl flex-col gap-4">
          {results!.map((asset) => (
            <div key={asset.id} className="rounded-md border bg-panel p-4">
              <AssetSummary asset={asset} onChanged={refresh} />
              <button
                type="button"
                onClick={() => toggleHistory(asset.id)}
                className="mt-3 flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {openHistory.has(asset.id) ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
                {t('assetFlow.history')}
              </button>
              {openHistory.has(asset.id) && (
                <div className="mt-3">
                  <AssetHistory assetId={asset.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

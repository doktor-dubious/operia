import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ParcelStatus } from '@/components/parcel-status-badge'
import { ParcelSummary } from '@/components/parcel-summary'
import { ScannerIndicator } from '@/components/scanner-indicator'
import { normalizeScan, useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/parcels/search')({
  component: SearchPage,
})

// Søg: chain-of-custody-opslag på stregkode — webbens modstykke til
// håndterminalens Søg-flise. Skrivebeskyttet, men hver træffer har hurtig-
// handlinger (Udlevér / Flyt / Tilstand), der åbner den rette side med pakken
// forudfyldt (?code=), så et opslag ikke ender blindt.

type Hit = {
  id: string
  barcode: string | null
  status: ParcelStatus
  registeredAt: string
  deliveredTo: string | null
  conditionNote: string | null
  conditionPhotoPath: string | null
  receiverName: string | null
  departmentName: string | null
  locationName: string | null
}

function SearchPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()

  const [lookup, setLookup] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [scanSignal, setScanSignal] = useState(0)
  const lookupRef = useRef<HTMLInputElement>(null)

  const search = async (term?: string) => {
    const q = normalizeScan(term ?? lookup)
    if (!q || !companyId) return
    const { data, error } = await supabase
      .from('parcels')
      .select(
        `id, barcode, status, registered_at, delivered_to, condition_note, condition_photo_path,
         receiver:employees (full_name),
         department:departments (name),
         location:storage_locations (name)`,
      )
      .eq('company_id', companyId)
      .eq('barcode', q)
      .order('registered_at', { ascending: false })
      .limit(20)
    if (error) {
      console.error('Søgning fejlede:', error)
      toast.error(describeError(error, t))
      return
    }
    setHits(
      data.map((d) => ({
        id: d.id,
        barcode: d.barcode,
        status: d.status,
        registeredAt: d.registered_at,
        deliveredTo: d.delivered_to,
        conditionNote: d.condition_note,
        conditionPhotoPath: d.condition_photo_path,
        receiverName: d.receiver?.full_name ?? null,
        departmentName: d.department?.name ?? null,
        locationName: d.location?.name ?? null,
      })),
    )
  }

  useBarcodeScanner({
    targetRef: lookupRef,
    onScan: (code) => {
      setLookup(code)
      setScanSignal((n) => n + 1)
      search(code)
    },
  })

  return (
    <Card className="w-full max-w-3xl bg-panel">
      <CardHeader>
        <CardTitle className="text-base">{t('nav.search')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="lookup">{t('handout.lookup')}</Label>
            <ScannerIndicator signal={scanSignal} />
          </div>
          <div className="flex gap-2">
            <Input
              id="lookup"
              ref={lookupRef}
              value={lookup}
              autoFocus
              autoComplete="off"
              placeholder={t('handout.lookupPlaceholder')}
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
        </div>

        {hits !== null &&
          (hits.length === 0 ? (
            <p className="text-xs text-status-neutral-to-bad">{t('handout.notFound')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {hits.map((p) => (
                <div key={p.id} className="rounded-md border bg-background/50 p-4">
                  <ParcelSummary parcel={p} />
                </div>
              ))}
            </div>
          ))}
      </CardContent>
    </Card>
  )
}

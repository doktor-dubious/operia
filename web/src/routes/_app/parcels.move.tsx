import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
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
import {
  ParcelStatusBadge,
  statusLabelKey,
  type ParcelStatus,
} from '@/components/parcel-status-badge'
import { ScannerIndicator } from '@/components/scanner-indicator'
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import { useCompanyContext } from '@/hooks/use-company-context'
import { moveRequiresLocation, moveTargets, type MoveStatus } from '@/lib/parcel-moves'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/parcels/move')({
  component: MovePage,
  // ?code=… forudfylder opslaget (fx fra Søg-siden).
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' && search.code ? search.code : undefined,
  }),
})

// Flyt pakke (spec Flow 2 — relokering): slå pakken op på stregkode, vælg ny
// flytte-status og placering. Webbens modstykke til håndterminalens Flyt-flise.
// DB-triggeren logger både 'status_changed' og 'moved' i parcel_events.

const NONE = '__none__'

type FoundParcel = {
  id: string
  barcode: string | null
  status: ParcelStatus
  receiverName: string | null
  locationId: string | null
  locationName: string | null
}

function MovePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { companyId } = useCompanyContext()
  const { code } = Route.useSearch()

  const [lookup, setLookup] = useState('')
  const [parcel, setParcel] = useState<FoundParcel | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [status, setStatus] = useState<MoveStatus | null>(null)
  const [locationId, setLocationId] = useState<string>(NONE)
  const [busy, setBusy] = useState(false)
  const [scanSignal, setScanSignal] = useState(0)
  const lookupRef = useRef<HTMLInputElement>(null)

  const { data: locations } = useQuery({
    queryKey: ['storage-locations', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('storage_locations')
        .select('id, name')
        .eq('company_id', companyId!)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data
    },
  })

  const search = async (term?: string) => {
    const q = (term ?? lookup).trim()
    if (!q || !companyId) return
    setNotFound(false)
    setParcel(null)
    const { data, error } = await supabase
      .from('parcels')
      .select(
        `id, barcode, status, storage_location_id,
         receiver:employees (full_name),
         location:storage_locations (name)`,
      )
      .eq('company_id', companyId)
      .eq('barcode', q)
      .order('registered_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('Opslag fejlede:', error)
      toast.error(describeError(error, t))
      return
    }
    if (!data) {
      setNotFound(true)
      return
    }
    const found: FoundParcel = {
      id: data.id,
      barcode: data.barcode,
      status: data.status,
      receiverName: data.receiver?.full_name ?? null,
      locationId: data.storage_location_id,
      locationName: data.location?.name ?? null,
    }
    setParcel(found)
    // Forudvælg pakkens nuværende placering, så en ren statusændring ikke
    // utilsigtet flytter pakken væk fra hylden.
    setLocationId(found.locationId ?? NONE)
    setStatus(moveTargets(found.status)[0] ?? null)
  }

  useBarcodeScanner({
    targetRef: lookupRef,
    onScan: (c) => {
      setLookup(c)
      setScanSignal((n) => n + 1)
      search(c)
    },
  })

  // Forudfyldt stregkode fra ?code= — slå op én gang, når virksomheden er kendt.
  const prefilled = useRef<string | null>(null)
  useEffect(() => {
    if (!code || !companyId || prefilled.current === code) return
    prefilled.current = code
    setLookup(code)
    search(code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, companyId])

  const targets = parcel ? moveTargets(parcel.status) : []
  const needsLocation = status ? moveRequiresLocation(status) : false
  const canMove =
    !!parcel && !!status && targets.length > 0 && (!needsLocation || locationId !== NONE)

  const move = async () => {
    if (!parcel || !status || !canMove) return
    setBusy(true)
    const { data, error } = await supabase
      .from('parcels')
      .update({ status, storage_location_id: locationId === NONE ? null : locationId })
      .eq('id', parcel.id)
      .select('id')
    setBusy(false)
    if (error) {
      console.error('Kunne ikke flytte pakke:', error)
      toast.error(describeError(error, t))
      return
    }
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      return
    }
    queryClient.invalidateQueries({ queryKey: ['parcels'] })
    queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
    toast.success(t('parcelDetail.relocatedToast', { barcode: parcel.barcode ?? '' }))
    setLookup('')
    setParcel(null)
    lookupRef.current?.focus()
  }

  return (
    <Card className="w-full max-w-2xl bg-panel">
      <CardHeader>
        <CardTitle className="text-base">{t('nav.move')}</CardTitle>
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
          {notFound && <p className="text-xs text-status-neutral-to-bad">{t('handout.notFound')}</p>}
        </div>

        {parcel && (
          <>
            <div className="rounded-md border bg-background/50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-sm">{parcel.barcode ?? '—'}</span>
                <ParcelStatusBadge status={parcel.status} />
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
                <dt className="text-muted-foreground">{t('parcels.receiver')}</dt>
                <dd>{parcel.receiverName ?? '—'}</dd>
                <dt className="text-muted-foreground">{t('parcels.location')}</dt>
                <dd>{parcel.locationName ?? '—'}</dd>
              </dl>
            </div>

            {targets.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('parcelDetail.notRelocatable', { status: t(statusLabelKey[parcel.status]) })}
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <Label>{t('parcelDetail.relocateStatus')}</Label>
                  <Select
                    value={status ?? undefined}
                    onValueChange={(v) => setStatus(v as MoveStatus)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(statusLabelKey[s])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>
                    {t('parcels.location')}
                    {needsLocation ? (
                      <span className="text-destructive"> *</span>
                    ) : (
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        ({t('common.optional')})
                      </span>
                    )}
                  </Label>
                  <Select value={locationId} onValueChange={setLocationId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {locations?.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-end">
                  <Button type="button" disabled={busy || !canMove} onClick={move}>
                    {busy ? t('common.loading') : t('parcelDetail.relocate')}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ParcelStatusBadge, type ParcelStatus } from '@/components/parcel-status-badge'
import { SignaturePad, signatureBlob } from '@/components/signature-pad'
import { ScannerIndicator } from '@/components/scanner-indicator'
import { normalizeScan, useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/parcels/handout')({
  component: HandoutPage,
  // ?code=… forudfylder opslaget (fx fra Søg-siden).
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' && search.code ? search.code : undefined,
  }),
})

// Udlever pakke (spec §handover): opslag på stregkode → pakkeinfo →
// modtagerbekræftelse (proxy kun hvis håndteringsklassen tillader det) →
// underskrift → 'delivered'. Afvisning → 'rejected' (flagges via hændelses-
// loggen til managerens undtagelseshåndtering).

const OPEN_STATUSES = ['registered', 'in_storage', 'in_transit', 'in_locker'] as const

type FoundParcel = {
  id: string
  barcode: string | null
  status: ParcelStatus
  receiverName: string | null
  departmentName: string | null
  locationName: string | null
  handlingName: string | null
  allowProxy: boolean
}

type SessionEntry = { id: string; barcode: string; deliveredTo: string; status: ParcelStatus }

function HandoutPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { companyId } = useCompanyContext()
  const { code } = Route.useSearch()

  const [lookup, setLookup] = useState('')
  const [parcel, setParcel] = useState<FoundParcel | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [deliveredTo, setDeliveredTo] = useState('')
  const [note, setNote] = useState('')
  const [hasInk, setHasInk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sessionList, setSessionList] = useState<SessionEntry[]>([])
  // Tælles op ved hver hardware-scanning, så ScannerIndicator kan blinke.
  const [scanSignal, setScanSignal] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lookupRef = useRef<HTMLInputElement>(null)

  // term kan gives af scanneren, da lookup-state opdateres asynkront.
  const search = async (term?: string) => {
    const q = normalizeScan(term ?? lookup)
    if (!q || !companyId) return
    setNotFound(false)
    setParcel(null)
    const { data, error } = await supabase
      .from('parcels')
      .select(
        `id, barcode, status,
         receiver:employees (full_name),
         department:departments (name),
         location:storage_locations (name),
         handling:handling_classes (name, allow_proxy_collection)`,
      )
      .eq('company_id', companyId)
      .eq('barcode', q)
      .in('status', [...OPEN_STATUSES])
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
      departmentName: data.department?.name ?? null,
      locationName: data.location?.name ?? null,
      handlingName: data.handling?.name ?? null,
      allowProxy: data.handling?.allow_proxy_collection ?? true,
    }
    setParcel(found)
    setDeliveredTo(found.receiverName ?? '')
    setNote('')
    setHasInk(false)
  }

  const reset = () => {
    setLookup('')
    setParcel(null)
    setNotFound(false)
    setDeliveredTo('')
    setNote('')
    setHasInk(false)
    lookupRef.current?.focus()
  }

  // Hardware-scanner (keyboard-wedge): en scanning slår pakken op med det samme,
  // også uden at opslagsfeltet er i fokus.
  useBarcodeScanner({
    targetRef: lookupRef,
    onScan: (code) => {
      setLookup(code)
      setScanSignal((n) => n + 1)
      search(code)
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

  const isProxy =
    !!parcel?.receiverName &&
    deliveredTo.trim().toLowerCase() !== parcel.receiverName.trim().toLowerCase()
  const proxyBlocked = isProxy && parcel !== null && !parcel.allowProxy
  const noReceiver = parcel !== null && (parcel.status === 'unassigned' || !parcel.receiverName)

  const finish = async (status: 'delivered' | 'rejected') => {
    if (!parcel || !companyId) return
    setBusy(true)
    try {
      let signaturePath: string | null = null
      if (status === 'delivered' && hasInk && canvasRef.current) {
        const blob = await signatureBlob(canvasRef.current)
        if (blob) {
          signaturePath = `${companyId}/${parcel.id}.png`
          const { error } = await supabase.storage
            .from('signatures')
            .upload(signaturePath, blob, { contentType: 'image/png', upsert: true })
          if (error) throw error
        }
      }

      const { error } = await supabase
        .from('parcels')
        .update({
          status,
          delivered_to: status === 'delivered' ? deliveredTo.trim() || null : null,
          delivered_note: note.trim() || null,
          delivered_signature_path: signaturePath,
        })
        .eq('id', parcel.id)
      if (error) throw error

      setSessionList((list) => [
        {
          id: parcel.id,
          barcode: parcel.barcode ?? '—',
          deliveredTo: status === 'delivered' ? deliveredTo.trim() : t('handout.rejected'),
          status,
        },
        ...list,
      ])
      queryClient.invalidateQueries({ queryKey: ['parcels'] })
      queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
      toast.success(
        status === 'delivered'
          ? t('handout.deliveredToast', { barcode: parcel.barcode ?? '' })
          : t('handout.rejectedToast', { barcode: parcel.barcode ?? '' }),
      )
      reset()
    } catch (error) {
      console.error('Udlevering fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <Card className="w-full max-w-2xl bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('nav.handout')}</CardTitle>
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
            {notFound && (
              <p className="text-xs text-status-neutral-to-bad">{t('handout.notFound')}</p>
            )}
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
                  <dt className="text-muted-foreground">{t('parcels.department')}</dt>
                  <dd>{parcel.departmentName ?? '—'}</dd>
                  <dt className="text-muted-foreground">{t('parcels.location')}</dt>
                  <dd>{parcel.locationName ?? '—'}</dd>
                  <dt className="text-muted-foreground">{t('receive.handling')}</dt>
                  <dd>{parcel.handlingName ?? '—'}</dd>
                </dl>
              </div>

              {noReceiver && (
                <p className="text-xs text-status-neutral-to-bad">
                  {t('handout.noReceiverWarning')}
                </p>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="deliveredTo">{t('handout.deliveredTo')}</Label>
                <Input
                  id="deliveredTo"
                  value={deliveredTo}
                  onChange={(e) => setDeliveredTo(e.target.value)}
                  placeholder={t('handout.deliveredToPlaceholder')}
                />
                {isProxy && !proxyBlocked && (
                  <p className="text-xs text-status-neutral">{t('handout.proxyHint')}</p>
                )}
                {proxyBlocked && (
                  <p className="text-xs text-destructive">{t('handout.proxyBlocked')}</p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="handout-note">{t('receive.note')}</Label>
                <Textarea
                  id="handout-note"
                  value={note}
                  rows={2}
                  placeholder={t('handout.notePlaceholder')}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>{t('handout.signature')}</Label>
                <SignaturePad canvasRef={canvasRef} onChange={setHasInk} />
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  disabled={busy || proxyBlocked || noReceiver || !deliveredTo.trim()}
                  onClick={() => finish('delivered')}
                >
                  {busy ? t('common.loading') : t('handout.confirm')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy || noReceiver}
                  onClick={() => finish('rejected')}
                >
                  {t('handout.reject')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="w-full max-w-md self-start bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('handout.sessionList')}</CardTitle>
        </CardHeader>
        <CardContent>
          {sessionList.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('handout.sessionEmpty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {sessionList.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs">{entry.barcode}</p>
                    <p className="truncate text-xs text-muted-foreground">{entry.deliveredTo}</p>
                  </div>
                  <ParcelStatusBadge status={entry.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

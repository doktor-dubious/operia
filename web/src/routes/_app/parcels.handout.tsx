import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Layers, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ParcelStatusBadge, type ParcelStatus } from '@/components/parcel-status-badge'
import { SignaturePad, signatureBlob } from '@/components/signature-pad'
import { ScannerIndicator } from '@/components/scanner-indicator'
import {
  EMPTY_OVERRIDE,
  ReceiverOverrideFields,
  describeOverrideError,
  overrideIncomplete,
  overrideReceiver,
  useCanOverrideReceiver,
  type OverrideState,
} from '@/components/parcel-receiver-override'
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
// underskrift → 'delivered'. Afvisning betyder "modtageren nægter modtagelse →
// send retur til afsender": pakken går derfor DIREKTE til 'returned' (ikke det
// mellemliggende 'rejected'), og en note er påkrævet, så managerens
// undtagelseshåndtering ved hvorfor.

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
  batchId: string | null
}

// Batchen bag en scannet pakke/batch-label + dens åbne medlemmer.
type BatchInfo = {
  id: string
  code: string
  receiverName: string | null
  openCount: number
  // Blev batchen fundet ved at scanne selve batch-labelen? Så gælder handlingen
  // altid hele batchen — "kun denne pakke" giver ingen mening (repræsentanten er
  // et vilkårligt medlem, brugeren aldrig valgte). Toggle vises kun når en
  // konkret pakkes stregkode blev scannet.
  viaLabel: boolean
}

type SessionEntry = { id: string; barcode: string; deliveredTo: string; status: ParcelStatus }

function HandoutPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { companyId } = useCompanyContext()
  const { code } = Route.useSearch()

  const [lookup, setLookup] = useState('')
  const [parcel, setParcel] = useState<FoundParcel | null>(null)
  // Batch bag den fundne pakke/batch-label (null = enkelt pakke). batchScope
  // afgør om handlingen rammer hele batchen ('all', standard) eller kun den
  // scannede pakke ('one').
  const [batch, setBatch] = useState<BatchInfo | null>(null)
  const [batchScope, setBatchScope] = useState<'all' | 'one'>('all')
  const [notFound, setNotFound] = useState(false)
  const [deliveredTo, setDeliveredTo] = useState('')
  const [note, setNote] = useState('')
  const [hasInk, setHasInk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [override, setOverride] = useState<OverrideState>(EMPTY_OVERRIDE)
  const [sessionList, setSessionList] = useState<SessionEntry[]>([])
  // Tælles op ved hver hardware-scanning, så ScannerIndicator kan blinke.
  const [scanSignal, setScanSignal] = useState(0)
  const canOverride = useCanOverrideReceiver()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lookupRef = useRef<HTMLInputElement>(null)

  const parcelSelect = `id, barcode, status, batch_id,
         receiver:employees!parcels_receiver_employee_id_fkey (full_name),
         department:departments (name),
         location:storage_locations (name),
         handling:handling_classes (name, allow_proxy_collection)`

  type ParcelRow = {
    id: string
    barcode: string | null
    status: ParcelStatus
    batch_id: string | null
    receiver: { full_name: string | null } | null
    department: { name: string | null } | null
    location: { name: string | null } | null
    handling: { name: string | null; allow_proxy_collection: boolean | null } | null
  }
  const mapParcel = (data: ParcelRow): FoundParcel => ({
    id: data.id,
    barcode: data.barcode,
    status: data.status,
    receiverName: data.receiver?.full_name ?? null,
    departmentName: data.department?.name ?? null,
    locationName: data.location?.name ?? null,
    handlingName: data.handling?.name ?? null,
    allowProxy: data.handling?.allow_proxy_collection ?? true,
    batchId: data.batch_id,
  })

  // Antal åbne medlemmer i en batch (til "udlever alle N").
  const loadBatch = async (batchId: string, viaLabel: boolean): Promise<BatchInfo | null> => {
    const [{ data: b }, { count }] = await Promise.all([
      supabase
        .from('parcel_batches')
        .select('id, batch_code, receiver:employees (full_name)')
        .eq('id', batchId)
        .maybeSingle(),
      supabase
        .from('parcels')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .in('status', [...OPEN_STATUSES]),
    ])
    if (!b) return null
    return {
      id: b.id,
      // Guard'en tildeler altid en kode ved INSERT; ?? '' er kun for typen.
      code: b.batch_code ?? '',
      receiverName: b.receiver?.full_name ?? null,
      openCount: count ?? 0,
      viaLabel,
    }
  }

  // term kan gives af scanneren, da lookup-state opdateres asynkront. Scanningen
  // kan være en pakkes stregkode ELLER en batch-labels kode (OPB-…): først slås
  // op på pakke, ellers på batch.
  const search = async (term?: string) => {
    const q = normalizeScan(term ?? lookup)
    if (!q || !companyId) return
    setNotFound(false)
    setParcel(null)
    setBatch(null)
    setBatchScope('all')

    const { data, error } = await supabase
      .from('parcels')
      .select(parcelSelect)
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

    let found: FoundParcel | null = data ? mapParcel(data as ParcelRow) : null
    let batchId = found?.batchId ?? null
    // En konkret pakke blev scannet (ikke batch-labelen) → "kun denne pakke" er
    // meningsfuldt. Blev batchen fundet via labelen, gælder altid hele batchen.
    let viaLabel = false

    // Ingen pakke matchede — prøv koden som en batch-label.
    if (!found) {
      const { data: b } = await supabase
        .from('parcel_batches')
        .select('id')
        .eq('company_id', companyId)
        .eq('batch_code', q)
        .maybeSingle()
      if (b) {
        batchId = b.id
        viaLabel = true
        // Repræsentant til udleveringsformularen: første åbne medlem.
        const { data: rep } = await supabase
          .from('parcels')
          .select(parcelSelect)
          .eq('batch_id', b.id)
          .in('status', [...OPEN_STATUSES])
          .order('registered_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        found = rep ? mapParcel(rep as ParcelRow) : null
      }
    }

    if (!found) {
      setNotFound(true)
      return
    }

    setParcel(found)
    if (batchId) setBatch(await loadBatch(batchId, viaLabel))
    setDeliveredTo(found.receiverName ?? '')
    setNote('')
    setHasInk(false)
    setOverride(EMPTY_OVERRIDE)
  }

  const reset = () => {
    setLookup('')
    setParcel(null)
    setBatch(null)
    setBatchScope('all')
    setNotFound(false)
    setDeliveredTo('')
    setNote('')
    setHasInk(false)
    setOverride(EMPTY_OVERRIDE)
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
  // En manager-overstyring ER undtagelsen fra proxy-reglen — den blokeres ikke.
  const proxyBlocked = isProxy && parcel !== null && !parcel.allowProxy && !override.active
  const noReceiver = parcel !== null && (parcel.status === 'unassigned' || !parcel.receiverName)

  // Hele batchen, hvis en batch er fundet og scope er 'all' — ellers kun den ene.
  const actOnBatch = batch !== null && batchScope === 'all'

  const finish = async (status: 'delivered' | 'returned') => {
    if (!parcel || !companyId) return
    // Afvisning kræver en note (håndhæves også af knappens disabled-tilstand).
    if (status === 'returned' && !note.trim()) return
    setBusy(true)
    try {
      let signaturePath: string | null = null
      if (status === 'delivered' && hasInk && canvasRef.current) {
        const blob = await signatureBlob(canvasRef.current)
        if (blob) {
          // Én underskrift dækker hele batchen; gemmes på en batch-sti og sættes
          // på alle medlemmerne.
          signaturePath = actOnBatch
            ? `${companyId}/batch-${batch!.id}.png`
            : `${companyId}/${parcel.id}.png`
          const { error } = await supabase.storage
            .from('signatures')
            .upload(signaturePath, blob, { contentType: 'image/png', upsert: true })
          if (error) throw error
        }
      }

      // Manager-overstyring: RPC'en tager pakke-id'erne, så en hel batch kan
      // afsluttes i én transaktion. Kun 'delivered' kan overstyres — en retur
      // til afsenderen har ingen "anden modtager".
      if (status === 'delivered' && override.active) {
        let parcelIds = [parcel.id]
        if (actOnBatch) {
          const { data: members, error: membersError } = await supabase
            .from('parcels')
            .select('id')
            .eq('batch_id', batch!.id)
            .in('status', [...OPEN_STATUSES])
          if (membersError) throw membersError
          parcelIds = (members ?? []).map((m) => m.id)
        }
        const count = await overrideReceiver({
          parcelIds,
          deliveredTo,
          reason: override.reason,
          employeeId: override.employee?.id ?? null,
          note,
          signaturePath,
        })
        setSessionList((list) => [
          {
            id: actOnBatch ? batch!.id : parcel.id,
            barcode: actOnBatch ? batch!.code : parcel.barcode ?? '—',
            deliveredTo: t('override.sessionEntry', { name: deliveredTo.trim(), count }),
            status,
          },
          ...list,
        ])
        queryClient.invalidateQueries({ queryKey: ['parcels'] })
        queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
        toast.success(
          count > 1
            ? t('override.doneBatchToast', { count })
            : t('override.doneToast', { barcode: parcel.barcode ?? '' }),
        )
        reset()
        return
      }

      const updates = {
        status,
        delivered_to: status === 'delivered' ? deliveredTo.trim() || null : null,
        delivered_note: note.trim() || null,
        delivered_signature_path: signaturePath,
      }
      // Batch: opdatér alle åbne medlemmer i én operation (hver række går gennem
      // guard + hændelseslog, så chain-of-custody bevares pr. pakke).
      const query = actOnBatch
        ? supabase.from('parcels').update(updates).eq('batch_id', batch!.id).in('status', [...OPEN_STATUSES])
        : supabase.from('parcels').update(updates).eq('id', parcel.id)
      const { data: updated, error } = await query.select('id')
      if (error) throw error
      // 0 opdaterede rækker = allerede håndteret et andet sted (eller RLS-
      // filtreret) — vis fejl frem for en falsk succes i sessionslisten.
      if (!updated?.length) {
        toast.error(t('handout.nothingUpdated'))
        queryClient.invalidateQueries({ queryKey: ['parcels'] })
        queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
        reset()
        return
      }

      const count = updated.length
      setSessionList((list) => [
        {
          id: actOnBatch ? batch!.id : parcel.id,
          barcode: actOnBatch ? batch!.code : parcel.barcode ?? '—',
          deliveredTo:
            status === 'delivered'
              ? actOnBatch
                ? t('handout.batchDeliveredTo', { count, name: deliveredTo.trim() })
                : deliveredTo.trim()
              : t('handout.rejected'),
          status,
        },
        ...list,
      ])
      queryClient.invalidateQueries({ queryKey: ['parcels'] })
      queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
      toast.success(
        actOnBatch
          ? status === 'delivered'
            ? t('handout.batchDeliveredToast', { count, code: batch!.code })
            : t('handout.batchRejectedToast', { count, code: batch!.code })
          : status === 'delivered'
            ? t('handout.deliveredToast', { barcode: parcel.barcode ?? '' })
            : t('handout.rejectedToast', { barcode: parcel.barcode ?? '' }),
      )
      reset()
    } catch (error) {
      console.error('Udlevering fejlede:', error)
      toast.error(describeOverrideError(error, t))
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
              {batch && (
                <div className="flex flex-col gap-3 rounded-md border border-primary/40 bg-primary/5 p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Layers className="size-4 text-primary" />
                    <span className="font-mono">{batch.code}</span>
                    <span className="text-muted-foreground">
                      {t('handout.batchBanner', {
                        count: batch.openCount,
                        receiver: batch.receiverName ?? '—',
                      })}
                    </span>
                  </div>
                  {/* Batch-labelen blev scannet ⇒ altid hele batchen; ingen toggle.
                      En konkret pakke blev scannet ⇒ tilbyd "kun denne pakke". */}
                  {batch.viaLabel ? (
                    <p className="text-xs text-muted-foreground">
                      {t('handout.batchWholeOnly', { count: batch.openCount })}
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={batchScope === 'all' ? 'default' : 'outline'}
                        onClick={() => setBatchScope('all')}
                      >
                        {t('handout.batchScopeAll', { count: batch.openCount })}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={batchScope === 'one' ? 'default' : 'outline'}
                        onClick={() => setBatchScope('one')}
                      >
                        {t('handout.batchScopeOne')}
                      </Button>
                    </div>
                  )}
                </div>
              )}

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
                {/* Noten er valgfri ved udlevering, men påkrævet ved afvisning. */}
                {!note.trim() && (
                  <p className="text-xs text-muted-foreground">{t('handout.rejectNeedsNote')}</p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label>{t('handout.signature')}</Label>
                <SignaturePad canvasRef={canvasRef} onChange={setHasInk} />
              </div>

              {canOverride && companyId && (
                <ReceiverOverrideFields
                  companyId={companyId}
                  intendedReceiver={parcel.receiverName}
                  value={override}
                  onChange={setOverride}
                  onEmployeePicked={(employee) => employee && setDeliveredTo(employee.full_name)}
                  disabled={busy}
                />
              )}

              <div className="flex gap-3">
                <Button
                  type="button"
                  disabled={
                    busy ||
                    proxyBlocked ||
                    noReceiver ||
                    !deliveredTo.trim() ||
                    overrideIncomplete(override)
                  }
                  onClick={() => finish('delivered')}
                >
                  {busy
                    ? t('common.loading')
                    : override.active
                      ? actOnBatch
                        ? t('override.confirmBatch', { count: batch!.openCount })
                        : t('override.confirm')
                      : actOnBatch
                        ? t('handout.confirmBatch', { count: batch!.openCount })
                        : t('handout.confirm')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy || noReceiver || !note.trim()}
                  onClick={() => finish('returned')}
                >
                  {actOnBatch ? t('handout.rejectBatch', { count: batch!.openCount }) : t('handout.reject')}
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

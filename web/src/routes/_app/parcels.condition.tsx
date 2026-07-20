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
import { ParcelDocumentList } from '@/components/parcel-condition'
import { PhotoCapture } from '@/components/photo-capture'
import { ScannerIndicator } from '@/components/scanner-indicator'
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/parcels/condition')({
  component: ConditionPage,
  // ?code=… forudfylder opslaget (fx fra Søg-siden).
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' && search.code ? search.code : undefined,
  }),
})

// Tilstand: vedhæft fotos + noter til en EKSISTERENDE pakke — webbens
// modstykke til håndterminalens Tilstand-flise. Slå pakken op på stregkode,
// se dens hidtidige dokumentation, og tilføj en ny post (foto + valgfri note).
// Hver post er append-only bevismateriale og logges i pakkens historik.
//
// Bevidst uden statusfilter: også en udleveret/afvist pakke kan have brug for
// dokumentation (skade opdaget efterfølgende).

type FoundParcel = {
  id: string
  barcode: string | null
  status: ParcelStatus
  receiverName: string | null
  departmentName: string | null
  locationName: string | null
}

function ConditionPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { companyId } = useCompanyContext()
  const { code } = Route.useSearch()

  const [lookup, setLookup] = useState('')
  const [parcel, setParcel] = useState<FoundParcel | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const [scanSignal, setScanSignal] = useState(0)
  const lookupRef = useRef<HTMLInputElement>(null)

  // term kan gives af scanneren, da lookup-state opdateres asynkront.
  const search = async (term?: string) => {
    const q = (term ?? lookup).trim()
    if (!q || !companyId) return
    setNotFound(false)
    setParcel(null)
    const { data, error } = await supabase
      .from('parcels')
      .select(
        `id, barcode, status,
         receiver:employees (full_name),
         department:departments (name),
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
    setParcel({
      id: data.id,
      barcode: data.barcode,
      status: data.status,
      receiverName: data.receiver?.full_name ?? null,
      departmentName: data.department?.name ?? null,
      locationName: data.location?.name ?? null,
    })
    setNote('')
    setPhoto(null)
  }

  // Hardware-scanner (keyboard-wedge): en scanning slår pakken op med det samme.
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

  const save = async () => {
    if (!parcel || !companyId || !photo) return
    setBusy(true)
    try {
      const path = `${companyId}/${parcel.id}/${Date.now()}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('parcel-photos')
        .upload(path, photo, { contentType: 'image/jpeg' })
      if (uploadError) throw uploadError

      const { error } = await supabase.from('parcel_documents').insert({
        parcel_id: parcel.id,
        company_id: companyId,
        storage_path: path,
        note: note.trim() || null,
      })
      if (error) throw error

      queryClient.invalidateQueries({ queryKey: ['parcel-documents', parcel.id] })
      toast.success(t('condition.saved'))
      setNote('')
      setPhoto(null)
    } catch (error) {
      console.error('Dokumentation fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <Card className="w-full max-w-2xl bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('nav.condition')}</CardTitle>
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
                </dl>
              </div>

              <div className="flex flex-col gap-2">
                <Label>{t('receive.photo')}</Label>
                <PhotoCapture photo={photo} onPhoto={setPhoto} />
                {!photo && <p className="text-xs text-muted-foreground">{t('condition.photoHint')}</p>}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="condition-note">{t('receive.note')}</Label>
                <Textarea
                  id="condition-note"
                  value={note}
                  rows={2}
                  placeholder={t('condition.notePlaceholder')}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="flex justify-end">
                <Button type="button" disabled={busy || !photo} onClick={save}>
                  {busy ? t('common.loading') : t('condition.add')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {parcel && (
        <Card className="w-full max-w-md self-start bg-panel">
          <CardHeader>
            <CardTitle className="text-base">{t('parcelDetail.documents')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ParcelDocumentList parcelId={parcel.id} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Layers, Printer, Wand2, X } from 'lucide-react'
import { useCompany } from '@/components/company-provider'
import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { printLabel } from '@/components/label-designer'
import { PhotoCapture } from '@/components/photo-capture'
import { ScannerIndicator } from '@/components/scanner-indicator'
import type { ParcelStatus } from '@/components/parcel-status-badge'
import { normalizeScan, useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import { useParcelLabelDesign } from '@/hooks/use-label-design'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { hasValidEmail, hasValidMsisdn } from '@/lib/notify-contact'
import { supabase } from '@/lib/supabase'

// Modtag pakke (spec Flow 1): stregkode → modtager-autocomplete (afdeling
// auto-udfyldes) → valgfri fragtfirma/håndtering/placering, tilstandsfoto
// (fil eller webcam) og note → gem. Uden modtager registreres pakken som
// 'unassigned' (håndhæves af DB-guarden).
//
// Genbruges på /parcels/receive (fuld side) og som popup på /parcels.

const NONE = '__none__'

export type ParcelSessionEntry = {
  id: string
  barcode: string
  receiver: string | null
  status: ParcelStatus
  // Nok til at printe pakkens label igen fra sessionslisten, uden at hente
  // pakken forfra.
  department: string | null
  carrier: string | null
}

// En afsluttet batch — nok til at printe batch-labelen (kun web) uden at hente
// batchen forfra.
export type BatchSessionEntry = {
  id: string
  batchCode: string
  receiver: string | null
  count: number
  department: string | null
}

function useMasterData(companyId: string | null) {
  return useQuery({
    queryKey: ['receive-master-data', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [departments, carriers, handling, locations, senders] = await Promise.all([
        supabase.from('departments').select('id, name').eq('company_id', companyId!).order('name'),
        supabase
          .from('carriers')
          .select('id, name')
          .eq('company_id', companyId!)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('handling_classes')
          .select('id, name')
          .eq('company_id', companyId!)
          .order('name'),
        supabase
          .from('storage_locations')
          .select('id, name')
          .eq('company_id', companyId!)
          .eq('is_active', true)
          .order('name'),
        // Afsender er fri tekst uden stamdata — forslagene er virksomhedens
        // egne tidligere afsendere (hyppigst brugte først).
        supabase.rpc('parcel_sender_suggestions', { p_company_id: companyId! }),
      ])
      const firstError = departments.error ?? carriers.error ?? handling.error ?? locations.error
      if (firstError) throw firstError
      return {
        departments: departments.data!,
        carriers: carriers.data!,
        handling: handling.data!,
        locations: locations.data!,
        // Forslag er nice-to-have: fejler opslaget, virker formularen stadig
        // (feltet er bare uden autocomplete).
        senders: senders.error ? [] : (senders.data ?? []),
      }
    },
  })
}

// Virksomhedens kanal-/ankomstindstillinger + SMS-tilvalget — bruges til at
// advare ved modtagelsen, hvis den valgte modtager slet ikke kan få besked
// (ingen gyldig kontakt for de aktiverede kanaler). Kun en advarsel: pakken
// kan stadig registreres.
function useArrivalNotifyConfig(companyId: string | null) {
  return useQuery({
    queryKey: ['arrival-notify-config', companyId],
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [company, features] = await Promise.all([
        supabase
          .from('companies')
          .select('notify_email_enabled, notify_sms_enabled, parcel_arrival_enabled')
          .eq('id', companyId!)
          .single(),
        supabase
          .from('company_features')
          .select('feature_key, valid_until')
          .eq('company_id', companyId!)
          .eq('feature_key', 'sms_notifications'),
      ])
      if (company.error) throw company.error
      // Kast også ved feature-fejl: et slugt svar ville ellers blive tolket
      // som "intet SMS-tilvalg" og give en falsk (eller manglende) advarsel.
      if (features.error) throw features.error
      const today = new Date().toISOString().slice(0, 10)
      const hasSms = (features.data ?? []).some(
        (f) => f.valid_until == null || f.valid_until >= today,
      )
      return { company: company.data, hasSms }
    },
  })
}

export function ParcelReceiveForm({
  companyId,
  onReceived,
  onBatchFinished,
}: {
  companyId: string
  // Kaldes efter en vellykket registrering. Formularen nulstiller sig selv
  // bagefter, så siden kan modtage næste pakke; en popup kan lukke sig her.
  onReceived?: (entry: ParcelSessionEntry) => void
  // Kaldes når en batch afsluttes (batch-tilstand). Bærer nok til at printe
  // batch-labelen. Er den ikke sat, skjules batch-tilstanden (fx i popup'en).
  onBatchFinished?: (entry: BatchSessionEntry) => void
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { activeCompany } = useCompany()
  const { data: master } = useMasterData(companyId)
  const { data: platform } = usePlatformSettings()
  const { data: notifyCfg } = useArrivalNotifyConfig(companyId)
  // Pakkelabelen (virksomhedens udgave, ellers platformens) — til print-knappen.
  const { data: labelDesign } = useParcelLabelDesign(companyId)

  const [barcode, setBarcode] = useState('')
  const [duplicate, setDuplicate] = useState(false)
  // Tælles op ved hver hardware-scanning, så ScannerIndicator kan blinke.
  const [scanSignal, setScanSignal] = useState(0)
  const [receiver, setReceiver] = useState<PickedEmployee | null>(null)
  const [sender, setSender] = useState('')
  const [departmentId, setDepartmentId] = useState<string>(NONE)
  const [carrierId, setCarrierId] = useState<string>(NONE)
  const [handlingId, setHandlingId] = useState<string>(NONE)
  const [locationId, setLocationId] = useState<string>(NONE)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [confirmUnassignedOpen, setConfirmUnassignedOpen] = useState(false)
  // Batch-tilstand: samme modtager for hele batchen, scan lægger sig i en liste,
  // og "afslut batch" opretter batchen + alle pakker på én gang → én notifikation.
  const batchAvailable = !!onBatchFinished
  const [batchMode, setBatchMode] = useState(false)
  const [batchItems, setBatchItems] = useState<string[]>([])
  // Koder i batch-listen der allerede står som åbne pakker i databasen — samme
  // dublet-advarsel som enkelt-tilstand (advarer, blokerer ikke).
  const [batchDupes, setBatchDupes] = useState<Set<string>>(new Set())
  // Remount-nøgle: EmployeePicker har intern skrivetilstand, som skal nulstilles
  // sammen med formularen — ellers står et forældet navn tilbage i feltet.
  const [formKey, setFormKey] = useState(0)
  const barcodeRef = useRef<HTMLInputElement>(null)

  // Punkt 3 i notifikationskravet: kan den valgte modtager slet ikke nås på
  // nogen af de aktiverede kanaler, meldes det ved modtagelsen — samme
  // effektive regler (override ?? platform, SMS kræver tilvalget) som
  // dispatch-parcel-notifications. Mangler konfigurationen (endnu ikke hentet),
  // vises ingen advarsel frem for en falsk.
  const receiverUnreachable = (() => {
    if (!receiver || !platform || !notifyCfg) return false
    if (!platform.parcel_notifications_enabled) return false
    const co = notifyCfg.company
    if (!(co.parcel_arrival_enabled ?? platform.parcel_arrival_enabled)) return false
    const emailOn = co.notify_email_enabled ?? platform.notify_email_enabled
    const smsOn = (co.notify_sms_enabled ?? platform.notify_sms_enabled) && notifyCfg.hasSms
    if (!emailOn && !smsOn) return false
    return !(
      (emailOn && hasValidEmail(receiver.email)) ||
      (smsOn && hasValidMsisdn(receiver.phone))
    )
  })()

  // Modtagervalg auto-udfylder afdeling (spec Flow 1)
  const pickReceiver = (employee: PickedEmployee | null) => {
    setReceiver(employee)
    if (employee?.department_id) setDepartmentId(employee.department_id)
  }

  // Står koden allerede som en åben pakke? (duplikat-scan er uafklaret i spec —
  // vi advarer, men blokerer ikke)
  const isOpenDuplicate = async (code: string) => {
    const { data } = await supabase
      .from('parcels')
      .select('id')
      .eq('company_id', companyId)
      .eq('barcode', code)
      // 'removed' er også slut-status: en fjernet fejlregistrering skal netop
      // kunne genregistreres uden dublet-advarsel.
      .not('status', 'in', '("delivered","returned","rejected","removed")')
      .limit(1)
    return !!data?.length
  }

  // Advarsel ved gen-scan af åben pakke.
  const checkDuplicate = async (code: string) => {
    const q = normalizeScan(code)
    setDuplicate(q ? await isOpenDuplicate(q) : false)
  }

  // Batch-tilstand: læg en scannet/indtastet kode i batch-listen (dedup) og ryd
  // feltet, klar til næste scan. Databasen tjekkes også — en pakke der allerede
  // ER registreret, markeres i listen (enkelt-tilstandens dublet-advarsel).
  const addBatchItem = (raw: string) => {
    const code = normalizeScan(raw)
    if (!code) return
    setBatchItems((list) => (list.includes(code) ? list : [code, ...list]))
    void isOpenDuplicate(code).then((dup) => {
      if (dup) setBatchDupes((s) => new Set(s).add(code))
    })
    setBarcode('')
    barcodeRef.current?.focus()
  }

  // Hardware-scanner (keyboard-wedge): en scanning hvor som helst på siden
  // udfylder stregkoden og tjekker for dublet — også uden at feltet er i fokus.
  // I batch-tilstand lægges scanningen i stedet direkte i batch-listen.
  useBarcodeScanner({
    targetRef: barcodeRef,
    onScan: (code) => {
      setScanSignal((n) => n + 1)
      if (batchMode) {
        addBatchItem(code)
        return
      }
      setBarcode(code)
      checkDuplicate(code)
    },
  })

  // Ulæselig stregkode på pakken: generér en Operia-kode (fortløbende pr.
  // virksomhed, serverside — klienten kan ikke selv finde på et nummer), som
  // så printes på en ny label og klistres på pakken.
  const generateBarcode = async () => {
    setGenerating(true)
    try {
      const { data, error } = await supabase.rpc('next_parcel_barcode', {
        p_company_id: companyId,
      })
      if (error) throw error
      setBarcode(data)
      setDuplicate(false)
      barcodeRef.current?.focus()
    } catch (error) {
      console.error('Kunne ikke generere stregkode:', error)
      toast.error(describeError(error, t))
    } finally {
      setGenerating(false)
    }
  }

  // Print en ny pakkelabel med det, der står i formularen lige nu. Bruges når
  // pakkens egen stregkode/QR-kode ikke kan læses — også før pakken gemmes, så
  // den kan mærkes med det samme.
  const printCurrentLabel = () => {
    const code = normalizeScan(barcode)
    if (!labelDesign || !code) return
    printLabel(labelDesign, i18n.language, activeCompany?.name, {
      code,
      reference: code,
      recipientName: receiver?.full_name ?? null,
      department: master?.departments.find((d) => d.id === departmentId)?.name ?? null,
      carrier: master?.carriers.find((c) => c.id === carrierId)?.name ?? null,
      date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short' }).format(new Date()),
    })
  }

  const reset = () => {
    setBarcode('')
    setDuplicate(false)
    setReceiver(null)
    setSender('')
    setDepartmentId(NONE)
    setCarrierId(NONE)
    setHandlingId(NONE)
    setLocationId(NONE)
    setNote('')
    setPhoto(null)
    setFormKey((k) => k + 1)
    barcodeRef.current?.focus()
  }

  // Uden matchet modtager bliver pakken 'unassigned' (DB-guarden). Det er en
  // gyldig, bevidst tilstand (spec Flow 1), men må ikke ske ved et uheld — så
  // gemning uden modtager kræver en eksplicit bekræftelse.
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (batchMode) {
      void finishBatch()
      return
    }
    if (!receiver) {
      setConfirmUnassignedOpen(true)
      return
    }
    void doSubmit()
  }

  // Afslut batch: opret batchen (server genererer batch_code, status 'finished')
  // og indsæt alle scannede pakker med batch_id på én gang. Én afsluttet batch ⇒
  // dispatcheren sender netop én ankomst-notifikation.
  const finishBatch = async () => {
    if (!receiver || batchItems.length === 0) return
    setSaving(true)
    try {
      const { data: batch, error: batchError } = await supabase
        .from('parcel_batches')
        .insert({
          company_id: companyId,
          receiver_employee_id: receiver.id,
          department_id: departmentId === NONE ? null : departmentId,
          status: 'finished',
        })
        .select('id, batch_code')
        .single()
      if (batchError) throw batchError

      const rows = batchItems.map((code) => ({
        company_id: companyId,
        barcode: code,
        receiver_employee_id: receiver.id,
        sender: sender.trim() || null,
        department_id: departmentId === NONE ? null : departmentId,
        carrier_id: carrierId === NONE ? null : carrierId,
        handling_class_id: handlingId === NONE ? null : handlingId,
        storage_location_id: locationId === NONE ? null : locationId,
        condition_note: note.trim() || null,
        batch_id: batch.id,
      }))
      const { error: parcelsError } = await supabase.from('parcels').insert(rows)
      if (parcelsError) throw parcelsError

      queryClient.invalidateQueries({ queryKey: ['parcels'] })
      queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
      toast.success(t('receive.batchSaved', { count: rows.length, code: batch.batch_code }))
      onBatchFinished?.({
        id: batch.id,
        // Guard'en tildeler altid en kode ved INSERT; ?? '' er kun for typen.
        batchCode: batch.batch_code ?? '',
        receiver: receiver.full_name,
        count: rows.length,
        department: master?.departments.find((d) => d.id === departmentId)?.name ?? null,
      })
      setBatchItems([])
      setBatchDupes(new Set())
      reset()
    } catch (error) {
      console.error('Batch fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setSaving(false)
    }
  }

  const doSubmit = async () => {
    setConfirmUnassignedOpen(false)
    setSaving(true)
    try {
      const { data: parcel, error } = await supabase
        .from('parcels')
        .insert({
          company_id: companyId,
          barcode: normalizeScan(barcode) || null,
          receiver_employee_id: receiver?.id ?? null,
          sender: sender.trim() || null,
          department_id: departmentId === NONE ? null : departmentId,
          carrier_id: carrierId === NONE ? null : carrierId,
          handling_class_id: handlingId === NONE ? null : handlingId,
          storage_location_id: locationId === NONE ? null : locationId,
          condition_note: note.trim() || null,
        })
        .select('id, status, barcode')
        .single()
      if (error) throw error

      if (photo) {
        const path = `${companyId}/${parcel.id}.jpg`
        const { error: uploadError } = await supabase.storage
          .from('parcel-photos')
          .upload(path, photo, { contentType: 'image/jpeg' })
        if (uploadError) throw uploadError
        const { error: updateError } = await supabase
          .from('parcels')
          .update({ condition_photo_path: path })
          .eq('id', parcel.id)
        if (updateError) throw updateError
      }

      queryClient.invalidateQueries({ queryKey: ['parcels'] })
      queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
      // Serveren genererer en intern stregkode (OPR-…) hvis der ikke blev
      // scannet én — vis DEN, så pakken kan mærkes/printes.
      toast.success(t('receive.saved', { barcode: parcel.barcode ?? parcel.id.slice(0, 8) }))
      onReceived?.({
        id: parcel.id,
        barcode: parcel.barcode ?? '—',
        receiver: receiver?.full_name ?? null,
        status: parcel.status,
        department: master?.departments.find((d) => d.id === departmentId)?.name ?? null,
        carrier: master?.carriers.find((c) => c.id === carrierId)?.name ?? null,
      })
      reset()
    } catch (error) {
      console.error('Modtagelse fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {batchAvailable && (
        <label className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm">
          <Checkbox
            checked={batchMode}
            onCheckedChange={(v) => {
              const on = v === true
              setBatchMode(on)
              if (!on) {
                setBatchItems([])
                setBatchDupes(new Set())
              }
              barcodeRef.current?.focus()
            }}
          />
          <Layers className="size-4 text-muted-foreground" />
          <span className="font-medium">{t('receive.batchMode')}</span>
          <span className="text-xs text-muted-foreground">{t('receive.batchModeHint')}</span>
        </label>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="barcode">{t('receive.barcode')}</Label>
          <ScannerIndicator signal={scanSignal} />
        </div>
        <Input
          id="barcode"
          ref={barcodeRef}
          value={barcode}
          autoFocus
          autoComplete="off"
          placeholder={t('receive.barcodePlaceholder')}
          onChange={(e) => setBarcode(e.target.value)}
          onBlur={() => checkDuplicate(barcode)}
          onKeyDown={(e) => {
            // Scannere sender Enter — det må ikke gemme en halv formular.
            // I batch-tilstand lægger Enter koden i batch-listen.
            if (e.key === 'Enter') {
              e.preventDefault()
              if (batchMode) addBatchItem(barcode)
              else checkDuplicate(barcode)
            }
          }}
        />
        {duplicate && !batchMode && (
          <p className="text-xs text-status-neutral-to-bad">{t('receive.duplicateWarning')}</p>
        )}
        {!batchMode && (
          /* Ulæselig stregkode/QR-kode: generér en ny kode og print en label. */
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={generating}
              onClick={() => void generateBarcode()}
            >
              <Wand2 className="size-3.5" />
              {generating ? t('common.loading') : t('receive.generateBarcode')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!labelDesign || !normalizeScan(barcode)}
              onClick={printCurrentLabel}
            >
              <Printer className="size-3.5" />
              {t('receive.printLabel')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('receive.unreadableHint')}</span>
          </div>
        )}
      </div>

      {batchMode && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>{t('receive.batchItems', { count: batchItems.length })}</Label>
            {batchItems.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setBatchItems([])
                  setBatchDupes(new Set())
                }}
              >
                {t('receive.batchClear')}
              </Button>
            )}
          </div>
          {batchItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('receive.batchEmpty')}</p>
          ) : (
            <ul className="max-h-40 divide-y divide-border overflow-auto rounded-md border">
              {batchItems.map((code) => (
                <li key={code} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="truncate font-mono text-xs">{code}</span>
                  {batchDupes.has(code) && (
                    <span className="shrink-0 text-xs text-status-neutral-to-bad">
                      {t('receive.batchDuplicate')}
                    </span>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    aria-label={t('receive.batchRemove')}
                    onClick={() => setBatchItems((list) => list.filter((c) => c !== code))}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label>{t('receive.receiver')}</Label>
        <EmployeePicker
          key={formKey}
          companyId={companyId}
          value={receiver}
          onChange={pickReceiver}
        />
        {receiverUnreachable && (
          <p className="text-xs text-status-neutral-to-bad">
            {t('receive.noContactWarning')}
          </p>
        )}
        {batchMode && !receiver && (
          <p className="text-xs text-muted-foreground">{t('receive.batchReceiverRequired')}</p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>{t('receive.department')}</Label>
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {master?.departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sender">{t('receive.sender')}</Label>
          {/* Fri tekst med autocomplete over virksomhedens tidligere afsendere
              (native datalist — skriv frit eller vælg et forslag). */}
          <Input
            id="sender"
            value={sender}
            list="sender-suggestions"
            autoComplete="off"
            placeholder={t('receive.senderPlaceholder')}
            onChange={(e) => setSender(e.target.value)}
          />
          <datalist id="sender-suggestions">
            {master?.senders.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('receive.carrier')}</Label>
          <Select value={carrierId} onValueChange={setCarrierId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {master?.carriers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('receive.handling')}</Label>
          <Select value={handlingId} onValueChange={setHandlingId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {master?.handling.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('receive.location')}</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {master?.locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!batchMode && (
        <div className="flex flex-col gap-2">
          <Label>{t('receive.photo')}</Label>
          <PhotoCapture photo={photo} onPhoto={setPhoto} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="note">{t('receive.note')}</Label>
        <Textarea
          id="note"
          value={note}
          placeholder={t('receive.notePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
      </div>
      <div className="flex justify-end">
        {batchMode ? (
          <Button type="submit" disabled={saving || !receiver || batchItems.length === 0}>
            {saving ? t('common.loading') : t('receive.finishBatch', { count: batchItems.length })}
          </Button>
        ) : (
          <Button type="submit" disabled={saving || (!barcode.trim() && !receiver)}>
            {saving ? t('common.loading') : t('nav.receive')}
          </Button>
        )}
      </div>
    </form>

    <Dialog
      open={confirmUnassignedOpen}
      onOpenChange={(o) => !saving && setConfirmUnassignedOpen(o)}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('receive.unassignedTitle')}</DialogTitle>
          <DialogDescription>{t('receive.unassignedBody')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setConfirmUnassignedOpen(false)}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void doSubmit()} disabled={saving}>
            {saving ? t('common.loading') : t('receive.unassignedConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

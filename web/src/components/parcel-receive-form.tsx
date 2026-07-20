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
import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { PhotoCapture } from '@/components/photo-capture'
import { ScannerIndicator } from '@/components/scanner-indicator'
import type { ParcelStatus } from '@/components/parcel-status-badge'
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner'
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
}

function useMasterData(companyId: string | null) {
  return useQuery({
    queryKey: ['receive-master-data', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [departments, carriers, handling, locations] = await Promise.all([
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
      ])
      const firstError = departments.error ?? carriers.error ?? handling.error ?? locations.error
      if (firstError) throw firstError
      return {
        departments: departments.data!,
        carriers: carriers.data!,
        handling: handling.data!,
        locations: locations.data!,
      }
    },
  })
}

export function ParcelReceiveForm({
  companyId,
  onReceived,
}: {
  companyId: string
  // Kaldes efter en vellykket registrering. Formularen nulstiller sig selv
  // bagefter, så siden kan modtage næste pakke; en popup kan lukke sig her.
  onReceived?: (entry: ParcelSessionEntry) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: master } = useMasterData(companyId)

  const [barcode, setBarcode] = useState('')
  const [duplicate, setDuplicate] = useState(false)
  // Tælles op ved hver hardware-scanning, så ScannerIndicator kan blinke.
  const [scanSignal, setScanSignal] = useState(0)
  const [receiver, setReceiver] = useState<PickedEmployee | null>(null)
  const [departmentId, setDepartmentId] = useState<string>(NONE)
  const [carrierId, setCarrierId] = useState<string>(NONE)
  const [handlingId, setHandlingId] = useState<string>(NONE)
  const [locationId, setLocationId] = useState<string>(NONE)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmUnassignedOpen, setConfirmUnassignedOpen] = useState(false)
  // Remount-nøgle: EmployeePicker har intern skrivetilstand, som skal nulstilles
  // sammen med formularen — ellers står et forældet navn tilbage i feltet.
  const [formKey, setFormKey] = useState(0)
  const barcodeRef = useRef<HTMLInputElement>(null)

  // Modtagervalg auto-udfylder afdeling (spec Flow 1)
  const pickReceiver = (employee: PickedEmployee | null) => {
    setReceiver(employee)
    if (employee?.department_id) setDepartmentId(employee.department_id)
  }

  // Advarsel ved gen-scan af åben pakke (duplikat-scan er uafklaret i spec —
  // vi advarer, men blokerer ikke)
  const checkDuplicate = async (code: string) => {
    if (!code.trim()) {
      setDuplicate(false)
      return
    }
    const { data } = await supabase
      .from('parcels')
      .select('id')
      .eq('company_id', companyId)
      .eq('barcode', code.trim())
      .not('status', 'in', '("delivered","returned","rejected")')
      .limit(1)
    setDuplicate(!!data?.length)
  }

  // Hardware-scanner (keyboard-wedge): en scanning hvor som helst på siden
  // udfylder stregkoden og tjekker for dublet — også uden at feltet er i fokus.
  useBarcodeScanner({
    targetRef: barcodeRef,
    onScan: (code) => {
      setBarcode(code)
      setScanSignal((n) => n + 1)
      checkDuplicate(code)
    },
  })

  const reset = () => {
    setBarcode('')
    setDuplicate(false)
    setReceiver(null)
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
    if (!receiver) {
      setConfirmUnassignedOpen(true)
      return
    }
    void doSubmit()
  }

  const doSubmit = async () => {
    setConfirmUnassignedOpen(false)
    setSaving(true)
    try {
      const { data: parcel, error } = await supabase
        .from('parcels')
        .insert({
          company_id: companyId,
          barcode: barcode.trim() || null,
          receiver_employee_id: receiver?.id ?? null,
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
            // Scannere sender Enter — det må ikke gemme en halv formular
            if (e.key === 'Enter') {
              e.preventDefault()
              checkDuplicate(barcode)
            }
          }}
        />
        {duplicate && (
          <p className="text-xs text-status-neutral-to-bad">{t('receive.duplicateWarning')}</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label>{t('receive.receiver')}</Label>
        <EmployeePicker
          key={formKey}
          companyId={companyId}
          value={receiver}
          onChange={pickReceiver}
        />
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
      <div className="flex flex-col gap-2">
        <Label>{t('receive.photo')}</Label>
        <PhotoCapture photo={photo} onPhoto={setPhoto} />
      </div>
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
        <Button type="submit" disabled={saving || (!barcode.trim() && !receiver)}>
          {saving ? t('common.loading') : t('nav.receive')}
        </Button>
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

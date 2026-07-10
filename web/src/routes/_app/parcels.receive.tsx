import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Camera, ImagePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { ParcelStatusBadge, type ParcelStatus } from '@/components/parcel-status-badge'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/parcels/receive')({
  component: ReceivePage,
})

// Modtag pakke (spec Flow 1): stregkode → modtager-autocomplete (afdeling
// auto-udfyldes) → valgfri fragtfirma/håndtering/placering, tilstandsfoto
// (fil eller webcam) og note → gem → sessionens liste. Uden modtager
// registreres pakken som 'unassigned' (håndhæves af DB-guarden).

const NONE = '__none__'

type SessionEntry = {
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

function PhotoCapture({
  photo,
  onPhoto,
}: {
  photo: Blob | null
  onPhoto: (blob: Blob | null) => void
}) {
  const { t } = useTranslation()
  const [camOpen, setCamOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const stopCam = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCamOpen(false)
  }

  useEffect(() => stopCam, [])

  const startCam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      setCamOpen(true)
      // videoRef findes først efter render
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream
      })
    } catch (error) {
      console.error('Webcam kunne ikke startes:', error)
      toast.error(t('receive.cameraError'))
    }
  }

  const capture = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (blob) onPhoto(blob)
        stopCam()
      },
      'image/jpeg',
      0.85,
    )
  }

  if (previewUrl) {
    return (
      <div className="flex items-start gap-3">
        <img src={previewUrl} alt="" className="h-24 rounded-md border object-cover" />
        <Button type="button" variant="ghost" size="sm" onClick={() => onPhoto(null)}>
          <X className="size-4" /> {t('receive.removePhoto')}
        </Button>
      </div>
    )
  }

  if (camOpen) {
    return (
      <div className="flex flex-col items-start gap-2">
        <video ref={videoRef} autoPlay playsInline className="h-40 rounded-md border" />
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={capture}>
            {t('receive.takePhoto')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={stopCam}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
        <ImagePlus className="size-4" /> {t('receive.uploadPhoto')}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={startCam}>
        <Camera className="size-4" /> {t('receive.useCamera')}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPhoto(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function ReceivePage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { companyId, companies, setCompanyId, isPending: companyPending } = useCompanyContext()
  const { data: master } = useMasterData(companyId)

  const [barcode, setBarcode] = useState('')
  const [duplicate, setDuplicate] = useState(false)
  const [receiver, setReceiver] = useState<PickedEmployee | null>(null)
  const [departmentId, setDepartmentId] = useState<string>(NONE)
  const [carrierId, setCarrierId] = useState<string>(NONE)
  const [handlingId, setHandlingId] = useState<string>(NONE)
  const [locationId, setLocationId] = useState<string>(NONE)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [saving, setSaving] = useState(false)
  const [sessionList, setSessionList] = useState<SessionEntry[]>([])
  const barcodeRef = useRef<HTMLInputElement>(null)

  // Modtagervalg auto-udfylder afdeling (spec Flow 1)
  const pickReceiver = (employee: PickedEmployee | null) => {
    setReceiver(employee)
    if (employee?.department_id) setDepartmentId(employee.department_id)
  }

  // Advarsel ved gen-scan af åben pakke (duplikat-scan er uafklaret i spec —
  // vi advarer, men blokerer ikke)
  const checkDuplicate = async (code: string) => {
    if (!code.trim() || !companyId) {
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
    barcodeRef.current?.focus()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return
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
        .select('id, status')
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

      setSessionList((list) => [
        {
          id: parcel.id,
          barcode: barcode.trim() || '—',
          receiver: receiver?.full_name ?? null,
          status: parcel.status,
        },
        ...list,
      ])
      queryClient.invalidateQueries({ queryKey: ['parcels'] })
      queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
      toast.success(t('receive.saved', { barcode: barcode.trim() || parcel.id.slice(0, 8) }))
      reset()
    } catch (error) {
      console.error('Modtagelse fejlede:', error)
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  if (companyPending) return <Skeleton className="h-40 w-full max-w-2xl" />

  if (!companyId) {
    return <p className="text-sm text-muted-foreground">{t('receive.noCompany')}</p>
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <Card className="w-full max-w-2xl bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('nav.receive')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            {companies.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label>{t('receive.company')}</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="barcode">{t('receive.barcode')}</Label>
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
                <p className="text-xs text-status-neutral-to-bad">
                  {t('receive.duplicateWarning')}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t('receive.receiver')}</Label>
              <EmployeePicker companyId={companyId} value={receiver} onChange={pickReceiver} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>{t('receive.department')}</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
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
                  <SelectTrigger>
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
                  <SelectTrigger>
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
                  <SelectTrigger>
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
            <div>
              <Button type="submit" disabled={saving || (!barcode.trim() && !receiver)}>
                {saving ? t('common.loading') : t('nav.receive')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="w-full max-w-md self-start bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('receive.sessionList')}</CardTitle>
        </CardHeader>
        <CardContent>
          {sessionList.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('receive.sessionEmpty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {sessionList.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs">{entry.barcode}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.receiver ?? t('dashboard.statusUnassigned')}
                    </p>
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

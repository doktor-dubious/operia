import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { statusLabelKey, type ParcelStatus } from '@/components/parcel-status-badge'
import { moveRequiresLocation, moveTargets, type MoveStatus } from '@/lib/parcel-moves'
import { supabase } from '@/lib/supabase'

const NONE = '__none__'

// Flow 2 (relokering): flyt en pakke til en ny placering og/eller flytte-status.
// DB'en logger både 'status_changed' og 'moved' i den immutable parcel_events
// via triggeren — her opdaterer vi bare pakken; sporbarheden skrives af sig selv.
export function ParcelRelocateDialog({
  open,
  onOpenChange,
  parcel,
  companyId,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  parcel: { id: string; barcode: string | null; status: ParcelStatus; locationId: string | null }
  companyId: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const targets = moveTargets(parcel.status)
  const [status, setStatus] = useState<MoveStatus>(targets[0] ?? 'in_storage')
  const [locationId, setLocationId] = useState<string>(NONE)
  const [busy, setBusy] = useState(false)

  const { data: locations } = useQuery({
    // Egen nøgle: locations.tsx ejer ['storage-locations', companyId] med de
    // fulde rækker (inkl. inaktive/barcode/beskrivelse). Deler vi nøglen, ville
    // denne aktive-kun {id,name}-forespørgsel og tabellens fulde forespørgsel
    // overskrive hinandens cache. locations.tsx' invalidateQueries på
    // ['storage-locations'] rammer stadig denne (præfiks-match).
    queryKey: ['storage-locations', companyId, 'active-picker'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('storage_locations')
        .select('id, name')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data
    },
  })

  // Nulstil felterne hver gang dialogen åbnes (evt. for en anden pakke).
  useEffect(() => {
    if (open) {
      setStatus(targets[0] ?? 'in_storage')
      setLocationId(parcel.locationId ?? NONE)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const needsLocation = moveRequiresLocation(status)
  const canSubmit = !busy && targets.length > 0 && (!needsLocation || locationId !== NONE)

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    const { data, error } = await supabase
      .from('parcels')
      .update({
        status,
        storage_location_id: locationId === NONE ? null : locationId,
      })
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
    toast.success(t('parcelDetail.relocatedToast', { barcode: parcel.barcode ?? parcel.id.slice(0, 8) }))
    onDone()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('parcelDetail.relocateTitle')}</DialogTitle>
          <DialogDescription>
            {t('parcelDetail.relocateDescription', { barcode: parcel.barcode ?? parcel.id.slice(0, 8) })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('parcelDetail.relocateStatus')}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as MoveStatus)}>
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
            <Label className="text-label">
              {t('parcels.location')}
              {needsLocation ? (
                <span className="text-destructive"> *</span>
              ) : (
                <span className="font-normal text-muted-foreground"> ({t('common.optional')})</span>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? t('common.loading') : t('parcelDetail.relocate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

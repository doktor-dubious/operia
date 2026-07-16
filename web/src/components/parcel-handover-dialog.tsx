import { useEffect, useRef, useState } from 'react'
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
import { SignaturePad, signatureBlob } from '@/components/signature-pad'
import { supabase } from '@/lib/supabase'

// Udlever pakke fra pakkens detaljepanel (spec §handover): modtager­bekræftelse
// (proxy kun hvis håndteringsklassen tillader det) → valgfri underskrift →
// status 'delivered'. Samme kerne-logik som /parcels/handout, men uden
// stregkode-opslag (pakken er allerede valgt).

export type HandoverParcel = {
  id: string
  barcode: string | null
  receiverName: string | null
  allowProxy: boolean
}

export function ParcelHandoverDialog({
  open,
  onOpenChange,
  parcel,
  companyId,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  parcel: HandoverParcel
  companyId: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [deliveredTo, setDeliveredTo] = useState(parcel.receiverName ?? '')
  const [note, setNote] = useState('')
  const [hasInk, setHasInk] = useState(false)
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Nulstil felterne hver gang dialogen åbnes for en (evt. anden) pakke.
  useEffect(() => {
    if (open) {
      setDeliveredTo(parcel.receiverName ?? '')
      setNote('')
      setHasInk(false)
    }
  }, [open, parcel.receiverName])

  const isProxy =
    !!parcel.receiverName &&
    deliveredTo.trim().toLowerCase() !== parcel.receiverName.trim().toLowerCase()
  const proxyBlocked = isProxy && !parcel.allowProxy

  const confirm = async () => {
    setBusy(true)
    try {
      let signaturePath: string | null = null
      if (hasInk && canvasRef.current) {
        const blob = await signatureBlob(canvasRef.current)
        if (blob) {
          signaturePath = `${companyId}/${parcel.id}.png`
          const { error } = await supabase.storage
            .from('signatures')
            .upload(signaturePath, blob, { contentType: 'image/png', upsert: true })
          if (error) throw error
        }
      }

      const { data, error } = await supabase
        .from('parcels')
        .update({
          status: 'delivered',
          delivered_to: deliveredTo.trim() || null,
          delivered_note: note.trim() || null,
          delivered_signature_path: signaturePath,
        })
        .eq('id', parcel.id)
        .select('id')
      if (error) throw error
      if (!data?.length) {
        toast.error(t('common.noPermission'))
        return
      }

      toast.success(t('handout.deliveredToast', { barcode: parcel.barcode ?? '' }))
      onDone()
      onOpenChange(false)
    } catch (error) {
      console.error('Udlevering fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('parcelDetail.handoverTitle')}</DialogTitle>
          <DialogDescription>
            {t('parcelDetail.handoverDescription', { barcode: parcel.barcode ?? parcel.id.slice(0, 8) })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="handover-to">{t('handout.deliveredTo')}</Label>
            <Input
              id="handover-to"
              value={deliveredTo}
              onChange={(e) => setDeliveredTo(e.target.value)}
              placeholder={t('handout.deliveredToPlaceholder')}
            />
            {isProxy && !proxyBlocked && (
              <p className="text-xs text-status-neutral">{t('handout.proxyHint')}</p>
            )}
            {proxyBlocked && <p className="text-xs text-destructive">{t('handout.proxyBlocked')}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="handover-note">{t('receive.note')}</Label>
            <Textarea
              id="handover-note"
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={confirm} disabled={busy || proxyBlocked || !deliveredTo.trim()}>
            {busy ? t('common.loading') : t('handout.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

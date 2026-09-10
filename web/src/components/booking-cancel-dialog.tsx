import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { Textarea } from '@/components/ui/textarea'
import { useAccess } from '@/hooks/use-access'
import { bookingRpcErrorKey, bookingTimeLabel, type BookingHit } from '@/lib/booking'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Afbestilling af en booking med årsag (EVU-krav A-07).
//
// Tidspunkt og ansvarlig stempler serveren selv (cancelled_at / cancelled_by);
// det eneste der skal indtastes, er årsagen — og den er PÅKRÆVET. Kravet
// nævner den som en af tre ting der skal registreres, og en valgfri
// begrundelse står tom i de fleste rækker. RPC'en afviser en tom årsag
// uanset hvad knappen her tillader.

/**
 * Må brugeren afbestille? Spejler `can_cancel_bookings` i databasen:
 * manager/booking_manager — IKKE booking_handler. En handler lægger bookinger
 * ind; at trække en booking ud af fakturagrundlaget er en anden slags
 * handling. Databasen håndhæver det uanset hvad UI'et viser.
 */
export function useCanCancelBookings(): boolean {
  const { data: access } = useAccess()
  if (!access) return false
  return access.isPlatformAdmin || access.isManager || access.roles.has('booking_manager')
}

export function BookingCancelDialog({
  booking,
  open,
  onOpenChange,
  onCancelled,
}: {
  booking: BookingHit | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Kaldes efter en gennemført afbestilling — lukker også redigeringsdialogen. */
  onCancelled: () => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  // Feltet ryddes hver gang dialogen åbnes, så en forladt indtastning ikke
  // følger med over på den næste booking.
  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const submit = async () => {
    if (!booking || !reason.trim() || busy) return
    setBusy(true)
    const { error } = await supabase.rpc('cancel_booking', {
      p_booking_id: booking.id,
      p_reason: reason.trim(),
    })
    setBusy(false)
    if (error) {
      const key = bookingRpcErrorKey(error)
      toast.error(key ? t(key) : describeError(error, t))
      return
    }
    toast.success(t('bookingFlow.cancelledToast'))
    onOpenChange(false)
    onCancelled()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('bookingFlow.cancelBooking')}</DialogTitle>
          <DialogDescription>{t('bookingFlow.cancelConfirm')}</DialogDescription>
        </DialogHeader>

        {booking && (
          <div className="rounded-md border border-border px-3 py-2 text-[13px]">
            <p className="font-medium">{booking.resource?.name ?? '—'}</p>
            <p className="text-muted-foreground">{bookingTimeLabel(booking)}</p>
            {booking.employee?.full_name && (
              <p className="text-muted-foreground">{booking.employee.full_name}</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="booking-cancel-reason" className="text-label">
            {t('bookingFlow.cancelReason')}
          </Label>
          <Textarea
            id="booking-cancel-reason"
            value={reason}
            rows={3}
            maxLength={500}
            placeholder={t('bookingFlow.cancelReasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('bookingFlow.cancelReasonHint')}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={!reason.trim() || busy} onClick={() => void submit()}>
            {busy ? t('common.loading') : t('bookingFlow.cancelBooking')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { BookingCancelDialog, useCanCancelBookings } from '@/components/booking-cancel-dialog'
import {
  BookingEmployeeField,
  BookingPurposeFields,
  BookingResourceField,
  BookingRetroNotice,
  BookingTimeFields,
  useBookingForm,
} from '@/components/booking-form'
import type { BookingHit } from '@/lib/booking'

// Opret/redigér en booking i en dialog. Felterne og hele regnestykket bor i
// booking-form.tsx og deles med detaljepanelet på bookinglisten — her er kun
// rammen og rækkefølgen.
//
// Genudstiller de hooks kalderne allerede importerede herfra, så kalenderen og
// listen ikke skal skifte importsti på én gang.
export {
  useBookingLevels,
  useBookingResources,
  useCompanyBookingConfig,
} from '@/components/booking-form'

export function BookingDialog({
  open,
  onOpenChange,
  companyId,
  booking,
  initialResourceId,
  initialDateISO,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  /** Sat = redigering; ellers oprettelse. */
  booking?: BookingHit | null
  initialResourceId?: string
  initialDateISO?: string
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const canCancel = useCanCancelBookings()
  const [cancelOpen, setCancelOpen] = useState(false)

  const form = useBookingForm({
    companyId,
    booking,
    initialResourceId,
    initialDateISO,
    onSaved,
    onDone: () => onOpenChange(false),
  })

  // Dialogen genbruges mellem åbninger, så felterne fyldes op igen hver gang
  // den åbnes — ikke kun når bookingen skifter.
  useEffect(() => {
    if (open) form.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Kun en aktiv booking kan afbestilles; en faktureret er låst (A-02/A-03),
  // og en allerede annulleret kan man slet ikke åbne redigeringen på.
  const canCancelThis =
    !!booking && canCancel && booking.status === 'booked' && !booking.invoiced_at

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {booking ? t('bookingFlow.editTitle') : t('bookingFlow.newTitle')}
          </DialogTitle>
        </DialogHeader>

        <BookingResourceField form={form} />
        <BookingEmployeeField form={form} />
        <BookingTimeFields form={form} />
        <BookingPurposeFields form={form} idPrefix="booking" />
        <BookingRetroNotice form={form} />

        <DialogFooter className="sm:justify-between">
          {/* Afbestilling (A-07) hører til her, hvor bookingen redigeres —
              ikke i detaljepopup'en. Vises kun ved redigering af en aktiv,
              ikke-faktureret booking, og kun for manager/booking_manager:
              en booking_handler ser ingen knap. Databasen håndhæver det
              samme via can_cancel_bookings. */}
          {canCancelThis ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setCancelOpen(true)}
            >
              {t('bookingFlow.cancelBooking')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!form.canSave} onClick={form.save}>
              {form.busy
                ? t('common.loading')
                : form.retro && form.retroAllowed
                  ? t('bookingFlow.retroConfirm')
                  : t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <BookingCancelDialog
        booking={booking ?? null}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onCancelled={() => {
          onSaved()
          onOpenChange(false)
        }}
      />
    </Dialog>
  )
}

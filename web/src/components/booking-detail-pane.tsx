import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CopyButton } from '@/components/copy-button'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { BookingCancelDialog, useCanCancelBookings } from '@/components/booking-cancel-dialog'
import { useCanManageBookings } from '@/components/booking-calendar'
import {
  BookingEmployeeField,
  BookingPurposeFields,
  BookingResourceField,
  BookingRetroNotice,
  BookingTimeFields,
  useBookingForm,
} from '@/components/booking-form'
import { BookingServicesTab } from '@/components/booking-services-tab'
import {
  BOOKING_LIFECYCLE_KEYS,
  bookingLifecycle,
  bookingLifecycleClass,
  bookingRpcErrorKey,
  bookingTimeLabel,
  type BookingHit,
} from '@/lib/booking'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Detaljepanelet under bookinglisten — samme master/detail-mønster som
// ressourcer og kategorier, i stedet for den popup listen brugte før. Panelet
// har plads til tilkøbsydelserne (A-06) og til handlingerne, som en popup
// ikke havde.
//
// Kalenderen beholder sin popup: dér klikker man på en bjælke i et overblik og
// vil se hvad den er, ikke redigere seks felter fordelt på faner.
//
// Felterne er de samme som i dialogen (booking-form.tsx) — kun fordelt på
// faner, med én fælles gem-bjælke, fordi update_booking skriver hele
// bookingen på én gang.

export function BookingDetailPane({
  booking,
  companyId,
  onClose,
  onDirtyChange,
  onCancelled,
  refresh,
}: {
  booking: BookingHit
  companyId: string | null
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onCancelled: () => void
  refresh: () => void
}) {
  const { t } = useTranslation()
  const canCancel = useCanCancelBookings()
  const canManage = useCanManageBookings()
  const [tab, setTab] = useState('details')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [invoiceBusy, setInvoiceBusy] = useState(false)

  const form = useBookingForm({ companyId, booking, onSaved: refresh })

  const stage = bookingLifecycle(booking)
  // Låst = der kan ikke længere redigeres: annulleret eller faktureret. Det er
  // samme grænse som update_booking håndhæver server-side (A-02/A-03).
  const locked = booking.status !== 'booked' || !!booking.invoiced_at

  useEffect(() => {
    onDirtyChange(form.dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.dirty])

  const setInvoiced = async (invoiced: boolean) => {
    setInvoiceBusy(true)
    const { error } = await supabase.rpc('set_booking_invoiced', {
      p_booking_id: booking.id,
      p_invoiced: invoiced,
    })
    setInvoiceBusy(false)
    if (error) {
      const key = bookingRpcErrorKey(error)
      toast.error(key ? t(key) : describeError(error, t))
      return
    }
    toast.success(t(invoiced ? 'bookingFlow.invoicedToast' : 'bookingFlow.invoiceClearedToast'))
    refresh()
  }

  const tabs = [
    { key: 'details', label: t('detail.tabDetails') },
    { key: 'calendar', label: t('bookingPage.tabCalendar') },
    { key: 'config', label: t('detail.tabConfiguration') },
    { key: 'services', label: t('bookingPage.tabServices') },
    { key: 'actions', label: t('detail.tabActions') },
  ]

  return (
    <>
      <DetailTabs tabs={tabs} active={tab} onChange={setTab} onClose={onClose}>
        {tab === 'details' && (
          <div className="flex max-w-2xl flex-col gap-5">
            <Field label="ID">
              <div className="relative">
                <Input value={booking.id} disabled className="pr-10 font-mono text-xs" />
                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                  <CopyButton value={booking.id} label={t('detail.copyId')} />
                </div>
              </div>
            </Field>
            <Field label={t('bookingPage.status')}>
              <p className={cn('text-[13px] font-medium', bookingLifecycleClass(stage))}>
                {t(BOOKING_LIFECYCLE_KEYS[stage])}
              </p>
            </Field>
            {booking.cancellation_reason && (
              <Field label={t('bookingFlow.cancelReason')}>
                <p className="text-[13px] text-muted-foreground">{booking.cancellation_reason}</p>
              </Field>
            )}
            {locked ? (
              <>
                <Field label={t('bookingFlow.resource')}>
                  <p className="text-[13px]">{booking.resource?.name ?? '—'}</p>
                </Field>
                <Field label={t('bookingFlow.employee')}>
                  <p className="text-[13px]">
                    {booking.employee?.full_name ?? t('bookingFlow.unknownEmployee')}
                  </p>
                </Field>
              </>
            ) : (
              <>
                <BookingResourceField form={form} />
                <BookingEmployeeField form={form} />
              </>
            )}
          </div>
        )}

        {tab === 'calendar' && (
          <div className="flex max-w-2xl flex-col gap-5">
            {locked ? (
              <Field label={t('bookingPage.when')}>
                <p className="text-[13px]">{bookingTimeLabel(booking)}</p>
              </Field>
            ) : (
              <>
                <BookingTimeFields form={form} />
                <BookingRetroNotice form={form} />
              </>
            )}
          </div>
        )}

        {tab === 'config' && (
          <div className="flex max-w-2xl flex-col gap-5">
            {locked ? (
              <>
                <Field label={t('bookingFlow.title')}>
                  <p className="text-[13px]">{booking.title || '—'}</p>
                </Field>
                <Field label={t('bookingFlow.participants')}>
                  <p className="text-[13px]">{booking.participant_count ?? '—'}</p>
                </Field>
                <Field label={t('bookingFlow.level')}>
                  <p className="text-[13px]">{booking.level?.name ?? '—'}</p>
                </Field>
              </>
            ) : (
              <BookingPurposeFields form={form} idPrefix={`bk-${booking.id}`} />
            )}
          </div>
        )}

        {tab === 'services' && (
          <BookingServicesTab booking={booking} companyId={companyId} locked={locked} />
        )}

        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            {stage === 'completed' && canManage && (
              <div className="flex items-center justify-between rounded-md border p-4">
                <div>
                  <p className="text-[13px] font-[450]">{t('bookingFlow.markInvoiced')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('bookingFlow.markInvoicedConfirm')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={invoiceBusy}
                  onClick={() => void setInvoiced(true)}
                >
                  {t('bookingFlow.markInvoiced')}
                </Button>
              </div>
            )}
            {stage === 'invoiced' && canManage && (
              <div className="flex items-center justify-between rounded-md border p-4">
                <div>
                  <p className="text-[13px] font-[450]">{t('bookingFlow.clearInvoiced')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('bookingFlow.clearInvoicedConfirm')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={invoiceBusy}
                  onClick={() => void setInvoiced(false)}
                >
                  {t('bookingFlow.clearInvoiced')}
                </Button>
              </div>
            )}
            {/* Afbestilling (A-07): kun på en aktiv, ikke-faktureret booking og
                kun for manager/booking_manager. En booking_handler ser ingen
                knap, og databasen afviser kaldet uanset. */}
            {!locked && canCancel && (
              <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
                <div>
                  <p className="text-[13px] font-[450] text-destructive">
                    {t('bookingFlow.cancelBooking')}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('bookingFlow.cancelConfirm')}</p>
                </div>
                <Button size="sm" variant="destructive" onClick={() => setCancelOpen(true)}>
                  {t('bookingFlow.cancelBooking')}
                </Button>
              </div>
            )}
            {locked && (
              <p className="text-[13px] text-muted-foreground">
                {booking.status === 'cancelled'
                  ? t('bookingPage.lockedCancelled')
                  : t('bookingPage.lockedInvoiced')}
              </p>
            )}
          </div>
        )}
      </DetailTabs>

      {form.dirty && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={form.reset} disabled={form.busy}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={form.save} disabled={!form.canSave}>
            {form.busy
              ? t('common.loading')
              : form.retro && form.retroAllowed
                ? t('bookingFlow.retroConfirm')
                : t('common.saveChanges')}
          </Button>
        </div>
      )}

      <BookingCancelDialog
        booking={booking}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onCancelled={() => {
          refresh()
          onCancelled()
        }}
      />
    </>
  )
}

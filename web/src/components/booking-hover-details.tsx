import { useTranslation } from 'react-i18next'
import {
  bookingLifecycle,
  bookingParticipantsLabel,
  bookingTimeLabel,
  BOOKING_LIFECYCLE_KEYS,
  type BookingHit,
} from '@/lib/booking'
import { bookingStageTextClass } from '@/lib/booking-look'
import { dayFormat } from '@/lib/calendar'
import { cn } from '@/lib/utils'

// Indholdet i svæve-kortet over en booking. Delt af tidslinjens bjælker og
// kalenderens brikker: samme booking skal fortælle det samme, uanset hvilken
// visning man står i. Kortet VISER kun — handlingerne bor i detaljedialogen,
// som et klik åbner.

export function BookingHoverDetails({
  booking,
  color,
}: {
  booking: BookingHit
  color: string
}) {
  const { t } = useTranslation()
  const stage = bookingLifecycle(booking)
  const purpose = booking.title || ''

  return (
    <div className="flex flex-col gap-1.5 text-[12px]">
      <div className="flex items-start gap-2">
        <span
          className="mt-1 size-2.5 shrink-0 rounded-[2px]"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 flex-1 text-[13px] font-medium">
          {booking.resource?.name ?? '—'}
        </span>
        <span className={cn('shrink-0 text-[11px]', bookingStageTextClass(stage))}>
          {t(BOOKING_LIFECYCLE_KEYS[stage])}
        </span>
      </div>
      <p>{bookingTimeLabel(booking)}</p>
      {purpose && <p className="text-muted-foreground">{purpose}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
        <dt>{t('bookingFlow.employee')}</dt>
        <dd className="truncate text-foreground">
          {booking.employee?.full_name ?? t('bookingFlow.unknownEmployee')}
        </dd>
        {bookingParticipantsLabel(booking) && (
          <>
            <dt>{t('bookingFlow.participants')}</dt>
            <dd className="truncate text-foreground">{bookingParticipantsLabel(booking)}</dd>
          </>
        )}
        {booking.resource?.location && (
          <>
            <dt>{t('bookingResourcesPage.location')}</dt>
            <dd className="truncate text-foreground">{booking.resource.location}</dd>
          </>
        )}
        {booking.invoiced_at && (
          <>
            <dt>{t('bookingFlow.invoicedAt')}</dt>
            <dd className="truncate text-foreground">
              {dayFormat.format(new Date(booking.invoiced_at))}
            </dd>
          </>
        )}
      </dl>
      {booking.cancellation_reason && (
        <p className="text-status-bad">
          {t('bookingFlow.cancelReason')}: {booking.cancellation_reason}
        </p>
      )}
      <p className="pt-0.5 text-[11px] text-muted-foreground">
        {t('bookingCalendar.clickForDetails')}
      </p>
    </div>
  )
}

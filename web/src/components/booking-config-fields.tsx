import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { BookingTimeMode } from '@/lib/booking'

// Fælles felter for booking-indstillingerne: Konfigurér → Booking (kunden) og
// Operia → Booking (platformens standard for nye kunder).
//  - Tidsgranularitet (klokkeslæt/hele dage); pr.-ressource-overstyring bor på
//    ressourcen selv.
//  - Tillad bookinger i fortiden (standard TIL): fra = RPC'erne afviser med
//    booking_in_past; til = klienten viser en blød advarsel.

export type BookingDayBasis = 'calendar' | 'weekday'

export type BookingConfigValue = {
  timeMode: BookingTimeMode
  retroAllowed: boolean
  /**
   * Hvordan "antal dage" tælles i fakturakladden (EVU C-01). Kun på
   * virksomheden — platformen har ingen standard for det, fordi det er et
   * spørgsmål om kundens prisliste, ikke om systemet. Udeladt = feltet vises ikke.
   */
  dayBasis?: BookingDayBasis
}

export function toBookingConfigValue(row: {
  booking_time_mode: string
  booking_retro_allowed: boolean
  booking_day_basis?: string
}): BookingConfigValue {
  return {
    timeMode: row.booking_time_mode === 'day' ? 'day' : 'timed',
    retroAllowed: row.booking_retro_allowed !== false,
    ...(row.booking_day_basis !== undefined
      ? { dayBasis: row.booking_day_basis === 'weekday' ? 'weekday' : 'calendar' }
      : {}),
  }
}

export function fromBookingConfigValue(v: BookingConfigValue) {
  return {
    booking_time_mode: v.timeMode,
    booking_retro_allowed: v.retroAllowed,
    ...(v.dayBasis ? { booking_day_basis: v.dayBasis } : {}),
  }
}

export function bookingConfigKey(v: BookingConfigValue): string {
  return `${v.timeMode}|${v.retroAllowed}|${v.dayBasis ?? ''}`
}

export function BookingConfigFields({
  value,
  onChange,
  idPrefix,
}: {
  value: BookingConfigValue
  onChange: (v: BookingConfigValue) => void
  idPrefix: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-mode`} className="text-label">
          {t('bookingConfig.timeMode')}
        </Label>
        <Select
          value={value.timeMode}
          onValueChange={(v) => onChange({ ...value, timeMode: v as BookingTimeMode })}
        >
          <SelectTrigger id={`${idPrefix}-mode`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="timed">{t('bookingConfig.modeTimed')}</SelectItem>
            <SelectItem value="day">{t('bookingConfig.modeDay')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('bookingConfig.timeModeHelp')}</p>
      </div>
      {value.dayBasis && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-daybasis`} className="text-label">
            {t('bookingConfig.dayBasis')}
          </Label>
          <Select
            value={value.dayBasis}
            onValueChange={(v) => onChange({ ...value, dayBasis: v as BookingDayBasis })}
          >
            <SelectTrigger id={`${idPrefix}-daybasis`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="calendar">{t('bookingConfig.dayBasisCalendar')}</SelectItem>
              <SelectItem value="weekday">{t('bookingConfig.dayBasisWeekday')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('bookingConfig.dayBasisHelp')}</p>
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-retro`} className="text-label">
            {t('bookingConfig.retroAllowed')}
          </Label>
          <p className="text-xs text-muted-foreground">{t('bookingConfig.retroAllowedHelp')}</p>
        </div>
        <Switch
          id={`${idPrefix}-retro`}
          checked={value.retroAllowed}
          onCheckedChange={(checked) => onChange({ ...value, retroAllowed: checked })}
        />
      </div>
    </div>
  )
}

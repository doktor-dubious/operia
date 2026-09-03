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

export type BookingConfigValue = {
  timeMode: BookingTimeMode
  retroAllowed: boolean
}

export function toBookingConfigValue(row: {
  booking_time_mode: string
  booking_retro_allowed: boolean
}): BookingConfigValue {
  return {
    timeMode: row.booking_time_mode === 'day' ? 'day' : 'timed',
    retroAllowed: row.booking_retro_allowed !== false,
  }
}

export function fromBookingConfigValue(v: BookingConfigValue) {
  return { booking_time_mode: v.timeMode, booking_retro_allowed: v.retroAllowed }
}

export function bookingConfigKey(v: BookingConfigValue): string {
  return `${v.timeMode}|${v.retroAllowed}`
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

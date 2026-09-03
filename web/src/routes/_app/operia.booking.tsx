import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  BookingConfigFields,
  bookingConfigKey,
  fromBookingConfigValue,
  toBookingConfigValue,
  type BookingConfigValue,
} from '@/components/booking-config-fields'
import { OperiaPage } from '@/components/operia-config-page'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Operia → Booking: platformens standarder (tidsgranularitet + bookinger i
// fortiden). Arves af NYE kunder (companies_booking_defaults-triggeren);
// eksisterende kunder ændrer deres egne under Konfigurér → Booking.
export const Route = createFileRoute('/_app/operia/booking')({
  component: OperiaBookingPage,
})

function usePlatformBookingConfig() {
  return useQuery({
    queryKey: ['platform-settings', 'booking'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('booking_time_mode, booking_retro_allowed')
        .single()
      if (error) throw error
      return data
    },
  })
}

function OperiaBookingPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformBookingConfig()
  const queryClient = useQueryClient()
  const [value, setValue] = useState<BookingConfigValue | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setValue(toBookingConfigValue(data))
  }, [data])

  const initial = data ? toBookingConfigValue(data) : null
  const dirty = !!value && !!initial && bookingConfigKey(value) !== bookingConfigKey(initial)

  const save = async () => {
    if (!value) return
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update(fromBookingConfigValue(value))
      .eq('id', true)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['platform-settings'] })
  }

  if (isPending || !value) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <OperiaPage title={t('nav.operiaBooking')} subtitle={t('bookingConfig.platformSubtitle')}>
        <BookingConfigFields idPrefix="platform" value={value} onChange={setValue} />
      </OperiaPage>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => data && setValue(toBookingConfigValue(data))}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}

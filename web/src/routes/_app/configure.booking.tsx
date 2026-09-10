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
import { BookingLevelsFields } from '@/components/booking-levels-fields'
import { OperiaPage } from '@/components/operia-config-page'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Konfigurér → Booking: virksomhedens tidsgranularitet (klokkeslæt eller hele
// dage, kan overstyres pr. ressource) og om bookinger i fortiden er tilladt.
export const Route = createFileRoute('/_app/configure/booking')({
  component: BookingConfigPage,
})

function useCompanyBookingConfigRow(companyId: string | null) {
  return useQuery({
    queryKey: ['booking-config', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('booking_time_mode, booking_retro_allowed')
        .eq('id', companyId!)
        .single()
      if (error) throw error
      return data
    },
  })
}

function BookingConfigPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data: access } = useAccess()
  const { data, isPending } = useCompanyBookingConfigRow(companyId)
  const queryClient = useQueryClient()
  const [value, setValue] = useState<BookingConfigValue | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setValue(toBookingConfigValue(data))
  }, [data])

  const initial = data ? toBookingConfigValue(data) : null
  const dirty = !!value && !!initial && bookingConfigKey(value) !== bookingConfigKey(initial)

  const save = async () => {
    if (!value || !companyId) return
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('companies')
      .update(fromBookingConfigValue(value))
      .eq('id', companyId)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('booking'),
    })
  }

  // Produktgate som menupunktet (nav.ts): siden findes ikke for kunder uden
  // booking-modulet — heller ikke via direkte URL.
  if (access && !access.isPlatformAdmin && !access.products.has('booking')) {
    return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  }

  if (isPending || !value) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <OperiaPage title={t('nav.configureBooking')} subtitle={t('bookingConfig.companySubtitle')}>
        <div className="flex flex-col gap-8">
          <BookingConfigFields idPrefix="cfg" value={value} onChange={setValue} />
          {/* Kursistniveauer (A-05) gemmer selv, række for række — se
              komponentens hovedkommentar. */}
          {companyId && <BookingLevelsFields companyId={companyId} />}
        </div>
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

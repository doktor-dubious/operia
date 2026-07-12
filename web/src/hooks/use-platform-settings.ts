import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Platformens sprogindstillinger (singleton-rækken i platform_settings).
// Bruges af Operia → Lokalisering (redigering) og Platform → Kunder
// (kundernes sprogvalg begrænses til platformens udvalg).
export function usePlatformSettings() {
  return useQuery({
    queryKey: ['platform-settings'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select(
          'supported_languages, default_language, supported_currencies, default_currency, quiet_hours_start, quiet_hours_end, parcel_reminder_1_days, parcel_reminder_2_days, parcel_reminder_max, parcel_reminder_1_enabled, parcel_reminder_2_enabled, shipping_model, shipping_margin_percent, shipping_margin_fixed, shipping_byoc_subscription, shipping_byoc_fee, locker_loan_ttl_hours',
        )
        .single()
      if (error) throw error
      return data
    },
  })
}

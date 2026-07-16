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
          'supported_languages, default_language, supported_currencies, default_currency, quiet_hours_start, quiet_hours_end, parcel_reminder_1_days, parcel_reminder_2_days, parcel_reminder_max, parcel_reminder_1_enabled, parcel_reminder_2_enabled, shipping_model, shipping_margin_percent, shipping_margin_fixed, shipping_byoc_subscription, shipping_byoc_fee, locker_loan_ttl_hours, maps_provider, refresh_interval_seconds, sftp_enabled, sftp_host, email_enabled, email_base_domain, email_antispoof_enabled, email_antispoof_strict, email_allowlist_required, import_schedule_enabled, import_schedule_time',
        )
        .single()
      if (error) throw error
      return data
    },
  })
}

// Auto-refresh-intervallet (sekunder, 0 = slået fra) fra platform_settings.
// Læsbart for alle brugere (RLS: using(true)) — driver den globale auto-refresh
// i app-skallen. Egen lille forespørgsel, så skallen ikke henter hele
// indstillings-rækken. Data ændres sjældent, så en rummelig staleTime er fin.
export function useRefreshInterval() {
  return useQuery({
    queryKey: ['refresh-interval'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('refresh_interval_seconds')
        .single()
      if (error) throw error
      return data.refresh_interval_seconds
    },
  })
}

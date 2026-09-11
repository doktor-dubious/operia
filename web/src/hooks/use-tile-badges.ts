import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import type { AccessInfo } from '@/lib/roles'

// Tal på forsidens fliser (EVU-krav C-04: "ingen afsluttet booking kan
// overses"). Rapporten og dens forvalg findes, men kræver at nogen åbner den —
// tallet på flisen er det, man ser uden at lede.
//
// Én forespørgsel pr. tal, kun `count` (ingen rækker hentes), og kun for de
// roller, der kan handle på det: en booking_handler kan ikke fakturere, og et
// tal, man ikke kan gøre noget ved, er støj.

export type TileBadge = { count: number; title: string }

export function useTileBadges(
  companyId: string | null,
  access: AccessInfo | undefined,
): Record<string, TileBadge> {
  const { t } = useTranslation()
  const canInvoice =
    !!access &&
    (access.isPlatformAdmin ||
      access.isManager ||
      access.roles.has('booking_manager') ||
      access.roles.has('finance_manager'))
  const { data } = useQuery({
    // Nøglen begynder med 'booking', så invalidateBookingQueries rammer den
    // (ellers står tallet, til staleTime løber ud).
    queryKey: ['booking-tile-badges', companyId, canInvoice],
    enabled: !!companyId && canInvoice,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId!)
        .eq('status', 'booked')
        .is('invoiced_at', null)
        .is('invoice_draft_id', null)
        .lt('ends_at', new Date().toISOString())
      if (error) throw error
      return { booking: count ?? 0 }
    },
  })
  if (!data) return {}
  return {
    booking: { count: data.booking, title: t('bookingReport.kpiCompletedNotInvoiced') },
  }
}

import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { supabase } from '@/lib/supabase'

// Tilkøbsydelser (EVU-krav A-06): fælles typer og beløbsregning for
// ydelseskataloget (/booking/services) og linjerne på en booking.

export type ServicePricing = {
  has_quantity: boolean
  price_mode: string
  unit_price: number | string
}

export type BookingServiceLine = {
  id: string
  service_id: string
  quantity: number
  unit_price: number | string
  price_mode: string
  service: { id: string; name: string; has_quantity: boolean; is_active: boolean; vat_code?: string | null } | null
}

/**
 * Linjebeløbet — ét sted, fordi både panelet, en kommende fakturakladde (C-01)
 * og et regnestykke i en rapport skal nå frem til det samme tal.
 *
 * 'unit'  → antal × pris
 * 'total' → prisen er beløbet, uanset antal
 */
export function lineTotal(line: { quantity: number; unit_price: number | string; price_mode: string }): number {
  const price = Number(line.unit_price ?? 0)
  return line.price_mode === 'total' ? price : price * (line.quantity ?? 1)
}

export function linesTotal(lines: { quantity: number; unit_price: number | string; price_mode: string }[]): number {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0)
}

/**
 * Virksomhedens valuta. Beløb vises i den, men GEMMES uden valutakode: en
 * virksomhed har én valuta, og en kode pr. række ville kunne komme ud af trit
 * med den.
 */
export function useCompanyCurrency(companyId: string | null): string {
  const { data } = useQuery({
    queryKey: ['booking-company-currency', companyId],
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('default_currency')
        .eq('id', companyId!)
        .single()
      if (error) throw error
      return data
    },
  })
  return data?.default_currency || 'DKK'
}

export function formatMoney(amount: number, currency: string, lang?: string): string {
  try {
    return new Intl.NumberFormat(lang || 'da-DK', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    // Ukendt valutakode må ikke vælte en tabel — vis tallet med koden bagefter.
    return `${amount.toFixed(2)} ${currency}`
  }
}

/** "Pr. enhed" / "Samlet beløb" / "Uden antal" — samme tekst i tabel og panel. */
export function servicePriceLabel(s: ServicePricing, t: TFunction): string {
  if (!s.has_quantity) return t('bookingServicesPage.noQuantity')
  return s.price_mode === 'total'
    ? t('bookingServicesPage.priceModeTotal')
    : t('bookingServicesPage.priceModeUnit')
}

export const BOOKING_SERVICE_LINE_SELECT =
  'id, service_id, quantity, unit_price, price_mode, service:booking_services (id, name, has_quantity, is_active, vat_code)'

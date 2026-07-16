import { useQuery } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

// Afbilder den aktuelle rute til et white-label-produkt (samme nøgler som
// product_appearance). Længste præfiks vinder; kun de seks produkter der kan
// tilpasses har en post.
const PATH_PRODUCT: [string, string][] = [
  ['/products/routes', 'routes'],
  ['/products/shipping', 'shipping'],
  ['/products/booking', 'booking'],
  ['/inventory', 'lager'],
  ['/assets', 'assets'],
  ['/parcels', 'parcels'],
]

function productForPath(pathname: string): string | null {
  for (const [prefix, key] of PATH_PRODUCT) {
    if (pathname === prefix || pathname.startsWith(prefix + '/') || pathname === prefix) return key
  }
  return null
}

export type ActiveAppearance = {
  productKey: string
  headerName: string | null
  headerColor: string | null
  theme: 'light' | 'dark' | null
  logoUrl: string | null
  watermarkUrl: string | null
}

// Udseendet for det produkt den aktuelle rute hører til (for den valgte
// virksomhed), så admin-kromen kan afspejle kundens white-labeling live.
// Query-nøglen deler præfiks med ['product-appearance', companyId], så et gem i
// Design-popup'en (som invaliderer netop det præfiks) opdaterer kromen straks.
export function useActiveAppearance(): ActiveAppearance | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { companyId } = useCompanyContext()
  const productKey = productForPath(pathname)

  const { data } = useQuery({
    queryKey: ['product-appearance', companyId, 'chrome', productKey],
    enabled: !!companyId && !!productKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_appearance')
        .select('product_key, header_name, header_color, theme, logo_url, watermark_url')
        .eq('company_id', companyId!)
        .eq('product_key', productKey!)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  if (!data) return null
  return {
    productKey: data.product_key,
    headerName: data.header_name,
    headerColor: data.header_color,
    theme: (data.theme as 'light' | 'dark' | null) ?? null,
    logoUrl: data.logo_url,
    watermarkUrl: data.watermark_url,
  }
}

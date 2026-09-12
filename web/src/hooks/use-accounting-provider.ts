import { useQuery } from '@tanstack/react-query'
import { accountingProvider, type AccountingProvider } from '@/lib/accounting'
import { supabase } from '@/lib/supabase'

// Hvilket regnskabssystem er koblet på virksomheden — hvis noget? Styrer om
// felterne "Produktnr. i <system>" vises på ydelse, kategori og niveau, og
// hvad de hedder. For en kunde uden regnskabsintegration er de kun støj.
//
// "Koblet på" = slået til OG forbindelsen testet: edge-funktionerne afviser
// en utestet integration (not_verified), så før testen ville felterne kun
// kunne vise "listen kunne ikke hentes". Samme regel som Overfør-knappen på
// kladden (economicReady).
//
// Nøglen ligger UNDER ['company-accounting', companyId], som Integrationer-
// skærmen bruger for hele rækken: dens invalidering efter gem/test rammer
// også denne (præfiks), uden at de to deler cache-post — rækkerne har
// forskellige kolonner, og en smal række må ikke lande i den brede post.
export function useAccountingProvider(companyId: string | null): AccountingProvider | null {
  const { data } = useQuery({
    queryKey: ['company-accounting', companyId, 'status'],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase
        .from('company_accounting_config')
        .select('enabled, provider, verified_at')
        .eq('company_id', companyId!)
        .maybeSingle()
      return data
    },
  })
  return data?.enabled && data.verified_at ? accountingProvider(data.provider) : null
}

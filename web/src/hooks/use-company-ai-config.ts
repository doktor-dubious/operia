import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Virksomhedens AI-valg (Konfigurér → Integrationer). Ét sted, fordi flere
// skærme spørger om det samme: AiLabelScan bruger provider/model til at afgøre
// om knappen overhovedet vises, og modtag-formularen bruger match_enabled til
// at afgøre om AI-aflæsningen skal fortolkes mod virksomhedens egne data.
// disclosure_accepted afgør om aflæsningen overhovedet må ske — kunden skal
// have bekræftet hvad der sendes hvorhen. Serveren genchecker det hele; dette
// styrer kun UI.
export function useCompanyAiConfig(companyId: string) {
  return useQuery({
    queryKey: ['company-ai', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_ai_config')
        .select('provider, model, match_enabled, disclosure_accepted')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

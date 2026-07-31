import { useQuery } from '@tanstack/react-query'
import {
  DEFAULT_BATCH_LABEL_DESIGN,
  DEFAULT_LABEL_DESIGN,
  parseLabelDesign,
  type LabelDesign,
} from '@/components/label-designer'
import { supabase } from '@/lib/supabase'

// Den label, der faktisk skal printes for en pakke: virksomhedens egen udgave
// af pakkelabelen hvis den findes (Konfigurér → Skabeloner), ellers platformens
// standard (Operia → Skabeloner). Samme rangorden som skabelonsiderne selv.
// Labels er sprogneutrale og ligger derfor i rækken lang='*'.
export const PACKAGE_LABEL_KEY = 'package_label'
// Batch-labelen: samme rangorden (virksomhed → platform → indbygget standard).
export const BATCH_LABEL_KEY = 'batch_label'

function useLabelDesign(companyId: string | null, key: string, fallback: LabelDesign) {
  return useQuery<LabelDesign>({
    queryKey: ['label-design', key, companyId],
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [platform, override] = await Promise.all([
        supabase.from('platform_templates').select('body').eq('key', key).eq('lang', '*').maybeSingle(),
        supabase
          .from('company_templates')
          .select('body')
          .eq('company_id', companyId!)
          .eq('key', key)
          .eq('lang', '*')
          .maybeSingle(),
      ])
      if (platform.error) throw platform.error
      if (override.error) throw override.error
      const body = override.data?.body ?? platform.data?.body
      return body ? parseLabelDesign(body) : fallback
    },
  })
}

export function useParcelLabelDesign(companyId: string | null) {
  return useLabelDesign(companyId, PACKAGE_LABEL_KEY, DEFAULT_LABEL_DESIGN)
}

export function useBatchLabelDesign(companyId: string | null) {
  return useLabelDesign(companyId, BATCH_LABEL_KEY, DEFAULT_BATCH_LABEL_DESIGN)
}

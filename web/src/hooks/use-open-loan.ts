import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Det åbne udlån for et aktiv (kun relevant for on_loan). Unik-indekset
// asset_loans_open_uniq garanterer højst én række.
//
// ÉN delt hook med det FULDE kolonnesæt: nøglen ['asset-open-loan', assetId]
// er en delt cache-post, så to varianter med forskellige kolonneudvalg ville
// overskrive hinanden — den smalle variant kunne så seede detaljepanelets
// låneformular med tomme kontaktfelter, og en gemning derfra ville blanke
// lånerens rigtige kontaktdata.
export function useOpenLoan(assetId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['asset-open-loan', assetId],
    enabled: !!assetId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_loans')
        .select(
          'id, to_name, to_address, to_email, to_phone, note, expires_at, lent_at, bounced_at, bounce_reason',
        )
        .eq('asset_id', assetId!)
        .is('returned_at', null)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

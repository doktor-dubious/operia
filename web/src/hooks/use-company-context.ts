import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccess } from '@/hooks/use-access'
import { useSession } from '@/hooks/use-session'
import { supabase } from '@/lib/supabase'

// Virksomhedskontekst for skærme der arbejder med tenant-data:
//  - tenant-brugere: egen virksomhed (app_users) — fast, ingen vælger.
//  - platform-admins: har ingen app_users-række; de vælger virksomhed
//    eksplicit (companies er RLS-synlige for dem alle sammen).
export function useCompanyContext() {
  const { session } = useSession()
  const { data: access } = useAccess()
  const [selected, setSelected] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['company-context', session?.user.id, access?.isPlatformAdmin],
    enabled: !!session && access !== undefined,
    queryFn: async () => {
      if (access!.isPlatformAdmin) {
        const { data, error } = await supabase.from('companies').select('id, name').order('name')
        if (error) throw error
        return { companies: data, own: null as string | null }
      }
      const { data, error } = await supabase
        .from('app_users')
        .select('company_id')
        .eq('user_id', session!.user.id)
        .maybeSingle()
      if (error) throw error
      return { companies: [] as { id: string; name: string }[], own: data?.company_id ?? null }
    },
  })

  const companies = data?.companies ?? []
  const companyId = data?.own ?? selected ?? companies[0]?.id ?? null

  return {
    companyId,
    companies, // tom for tenant-brugere; >0 ⇒ vis virksomhedsvælger
    setCompanyId: setSelected,
    isPending,
  }
}

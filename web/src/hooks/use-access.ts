import { useQuery } from '@tanstack/react-query'
import type { AccessInfo } from '@/lib/nav'
import { useSession } from '@/hooks/use-session'
import { supabase } from '@/lib/supabase'

// Brugerens adgangsniveau til nav-/skærmgating. RLS og server-tjek er den
// reelle håndhævelse — dette styrer kun hvad UI'et viser.
export function useAccess() {
  const { session } = useSession()
  return useQuery({
    queryKey: ['access', session?.user.id],
    enabled: !!session,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<AccessInfo> => {
      const [admin, manager, prods] = await Promise.all([
        supabase.rpc('is_platform_admin'),
        supabase.rpc('has_role', { r: 'manager' }),
        supabase.from('company_products').select('product_key, valid_until'),
      ])
      const today = new Date().toISOString().slice(0, 10)
      return {
        isPlatformAdmin: admin.data === true,
        isManager: manager.data === true,
        products: new Set(
          (prods.data ?? [])
            .filter((p) => !p.valid_until || p.valid_until >= today)
            .map((p) => p.product_key),
        ),
      }
    },
  })
}

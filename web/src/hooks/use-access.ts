import { useQuery } from '@tanstack/react-query'
import type { AccessInfo, AppRole } from '@/lib/roles'
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
      const [admin, roleRows, prods] = await Promise.all([
        supabase.rpc('is_platform_admin'),
        supabase.from('user_roles').select('role').eq('user_id', session!.user.id),
        supabase.from('company_products').select('product_key, valid_until, product_catalog (enabled)'),
      ])
      // supabase-js afviser IKKE ved fejl — den løser med { data: null, error }.
      // Uden dette tjek ville en forbigående fejl på user_roles blive til et tomt
      // rollesæt, der caches som "succes" i staleTime (5 min): en manager låst
      // ude af hele UI'et. Kast i stedet, så react-query prøver igen/fejler
      // synligt (RoleGuard viser en fejl, ikke en tavs adgangsnægtelse).
      if (admin.error) throw admin.error
      if (roleRows.error) throw roleRows.error
      if (prods.error) throw prods.error
      const today = new Date().toISOString().slice(0, 10)
      const roles = new Set<AppRole>((roleRows.data ?? []).map((r) => r.role))
      return {
        isPlatformAdmin: admin.data === true,
        isManager: roles.has('manager'),
        roles,
        products: new Set(
          (prods.data ?? [])
            .filter((p) => p.product_catalog?.enabled !== false)
            .filter((p) => !p.valid_until || p.valid_until >= today)
            .map((p) => p.product_key),
        ),
      }
    },
  })
}

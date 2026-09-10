import { useQuery } from '@tanstack/react-query'
import { useCompanyContext } from '@/hooks/use-company-context'
import { normalizeDesign, normalizeLayout } from '@/lib/home-tiles'
import { supabase } from '@/lib/supabase'

// Home-layoutet: kundens egen overstyring (company_home_config) hvis den findes,
// ellers platformens standard (platform_settings). Delt af startsiden (Home) og
// sidemenuen, så begge læser samme cache-nøgle og opdateres samtidig efter et
// gem i Home-design.
//
// `enabled` må først være sand når virksomhedskonteksten er afgjort: mens den
// hentes er companyId endnu null, og en forespørgsel dér ville hente — og vise —
// platformens standardbranding et øjeblik, før den aktive virksomheds eget
// design overtager. Uden gaten blinker forkert titel/undertitel ved hver
// indlæsning af startsiden.
export function useHomeConfig(companyId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['home-config', companyId],
    enabled,
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (companyId) {
        const { data: own } = await supabase
          .from('company_home_config')
          .select('home_tiles, home_design')
          .eq('company_id', companyId)
          .maybeSingle()
        if (own)
          return { tiles: normalizeLayout(own.home_tiles), design: normalizeDesign(own.home_design) }
      }
      const { data, error } = await supabase
        .from('platform_settings')
        .select('home_tiles, home_design')
        .single()
      if (error) throw error
      return { tiles: normalizeLayout(data.home_tiles), design: normalizeDesign(data.home_design) }
    },
  })
}

// De sidemenu-moduler kunden har fravalgt (Home-design → Sidemenu). Null indtil
// konfigurationen er hentet — kaldere venter med at tegne modulknapperne, så et
// fravalgt modul ikke når at blinke frem.
// Fejler opslaget (netværk, RLS, manglende række), vises ALLE moduler: en
// fravalgt knap for meget er langt bedre end en menu uden opgavesider — bund-
// dropdownen udelader netop de sider, den regner med står i rådet.
export function useHiddenSidebarModules(): ReadonlySet<string> | null {
  const { companyId, isPending } = useCompanyContext()
  const { data, isError } = useHomeConfig(companyId, !isPending)
  if (data) return new Set(data.design.sidebarHidden)
  return isError ? new Set() : null
}

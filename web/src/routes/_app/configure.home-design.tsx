import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { HomeDesignEditor } from '@/components/home-design-editor'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import type { AccessInfo } from '@/lib/nav'
import {
  normalizeDesign,
  normalizeLayout,
  TILE_BY_PRODUCT,
  type HomeDesign,
  type TileLayoutItem,
} from '@/lib/home-tiles'
import { supabase } from '@/lib/supabase'

// Konfigurér → Home-design: kundens egen opsætning af startsiden (Home). En
// kopi af Operia → Home-design, men kun med de produkter virksomheden har
// adgang til. Starter fra platformens standarddesign (platform_settings) og
// gemmes som en overstyring pr. virksomhed (company_home_config); findes en
// sådan række, bruger Home den frem for platformens standard.
export const Route = createFileRoute('/_app/configure/home-design')({
  component: ConfigureHomeDesignPage,
})

// Samme adgangs-filter som Home: kerneproduktet altid; ellers kræves aktivt
// entitlement (platform-admins ser alt). Billede-/tomme fliser rammes ikke.
function makeAllowProduct(access: AccessInfo) {
  return (product: string) => {
    const tile = TILE_BY_PRODUCT[product]
    if (!tile) return false
    if (tile.core) return true
    return access.isPlatformAdmin || (!!tile.entitlement && access.products.has(tile.entitlement))
  }
}

function useCompanyHomeConfig(companyId: string | null, access: AccessInfo | undefined) {
  return useQuery({
    queryKey: ['company-home-config-edit', companyId],
    enabled: !!companyId && !!access,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const allowProduct = makeAllowProduct(access!)
      // Kundens egen overstyring, hvis den findes; ellers platformens standard
      // (som Home også falder tilbage til, indtil kunden gemmer sin egen).
      const { data: own, error: ownErr } = await supabase
        .from('company_home_config')
        .select('home_tiles, home_design')
        .eq('company_id', companyId!)
        .maybeSingle()
      if (ownErr) throw ownErr
      const src =
        own ??
        (await supabase.from('platform_settings').select('home_tiles, home_design').single()).data
      return {
        tiles: normalizeLayout(src?.home_tiles, { allowProduct }),
        design: normalizeDesign(src?.home_design),
      }
    },
  })
}

function ConfigureHomeDesignPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data: access } = useAccess()
  const { data, isPending } = useCompanyHomeConfig(companyId, access)
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const save = async (tiles: TileLayoutItem[], design: HomeDesign) => {
    if (!companyId) return
    setSaving(true)
    const { error } = await supabase
      .from('company_home_config')
      .upsert({ company_id: companyId, home_tiles: tiles, home_design: design })
    setSaving(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-home-config-edit', companyId] })
    queryClient.invalidateQueries({ queryKey: ['home-config'] })
  }

  if (!companyId || isPending || !data) return <Skeleton className="h-40 w-full" />

  return (
    <HomeDesignEditor
      title={t('configureHomeDesign.title')}
      subtitle={t('configureHomeDesign.subtitle')}
      banner={
        <p className="mb-6 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t('configureHomeDesign.hint')}
        </p>
      }
      baseTiles={data.tiles}
      baseDesign={data.design}
      saving={saving}
      onSave={save}
      companyId={companyId}
    />
  )
}

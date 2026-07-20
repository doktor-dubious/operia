import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { HandheldDesignEditor } from '@/components/handheld-design-editor'
import { useCompanyContext } from '@/hooks/use-company-context'
import {
  normalizeHandheldDesign,
  normalizeHandheldTiles,
  type HandheldDesign,
  type HandheldTileItem,
} from '@/lib/handheld-tiles'
import { supabase } from '@/lib/supabase'

// Konfigurér → Handheld-design: kundens egen opsætning af håndterminalens
// startskærm. En kopi af Operia → Handheld-design, men gemt som en overstyring
// pr. virksomhed (company_handheld_config). Findes der ingen række, vises —
// og bruges — platformens standard, så en ny kunde starter med Operia-designet.
export const Route = createFileRoute('/_app/configure/handheld-design')({
  component: ConfigureHandheldDesignPage,
})

function useCompanyHandheldConfig(companyId: string | null) {
  return useQuery({
    queryKey: ['company-handheld-config-edit', companyId],
    enabled: !!companyId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      // Kundens egen overstyring, hvis den findes; ellers platformens standard
      // (som håndterminalen også falder tilbage til indtil kunden gemmer).
      const { data: own, error: ownErr } = await supabase
        .from('company_handheld_config')
        .select('handheld_tiles, handheld_design')
        .eq('company_id', companyId!)
        .maybeSingle()
      if (ownErr) throw ownErr
      const src =
        own ??
        (
          await supabase
            .from('platform_settings')
            .select('handheld_tiles, handheld_design')
            .single()
        ).data
      return {
        tiles: normalizeHandheldTiles(src?.handheld_tiles),
        design: normalizeHandheldDesign(src?.handheld_design),
        inherited: !own,
      }
    },
  })
}

function ConfigureHandheldDesignPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useCompanyHandheldConfig(companyId)
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const save = async (tiles: HandheldTileItem[], design: HandheldDesign) => {
    if (!companyId) return
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('company_handheld_config')
      .upsert({ company_id: companyId, handheld_tiles: tiles, handheld_design: design })
      .select('company_id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-handheld-config-edit', companyId] })
  }

  if (!companyId || isPending || !data) return <Skeleton className="h-40 w-full" />

  return (
    <HandheldDesignEditor
      title={t('configureHandheldDesign.title')}
      subtitle={t('configureHandheldDesign.subtitle')}
      banner={
        <p className="mb-6 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {data.inherited
            ? t('configureHandheldDesign.inherited')
            : t('configureHandheldDesign.hint')}
        </p>
      }
      baseTiles={data.tiles}
      baseDesign={data.design}
      saving={saving}
      onSave={save}
    />
  )
}

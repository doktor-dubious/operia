import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { HandheldActions } from '@/components/handheld-actions'
import { HandheldDesignEditor } from '@/components/handheld-design-editor'
import {
  normalizeHandheldDesign,
  normalizeHandheldTiles,
  type HandheldDesign,
  type HandheldTileItem,
} from '@/lib/handheld-tiles'
import { supabase } from '@/lib/supabase'

// Operia → Handheld-design: platformens standardopsætning af Android-håndter-
// minalens startskærm. Hentes fra/gemmes på singleton-rækken platform_settings
// (handheld_tiles/handheld_design) — sidestykket til Home-design.
export const Route = createFileRoute('/_app/operia/handheld-design')({
  component: HandheldDesignPage,
})

function useHandheldConfig() {
  return useQuery({
    queryKey: ['platform-handheld-config'],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('handheld_tiles, handheld_design')
        .single()
      if (error) throw error
      return {
        tiles: normalizeHandheldTiles(data.handheld_tiles),
        design: normalizeHandheldDesign(data.handheld_design),
      }
    },
  })
}

function HandheldDesignPage() {
  const { t } = useTranslation()
  const { data, isPending } = useHandheldConfig()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const save = async (tiles: HandheldTileItem[], design: HandheldDesign) => {
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({ handheld_tiles: tiles, handheld_design: design })
      .eq('id', true)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['platform-handheld-config'] })
  }

  if (isPending || !data) return <Skeleton className="h-40 w-full" />

  return (
    <HandheldDesignEditor
      title={t('handheldDesignPage.title')}
      subtitle={t('handheldDesignPage.subtitle')}
      baseTiles={data.tiles}
      baseDesign={data.design}
      saving={saving}
      onSave={save}
      extraTabs={[
        {
          key: 'actions',
          label: t('handheldActions.tab'),
          content: <HandheldActions />,
        },
      ]}
    />
  )
}

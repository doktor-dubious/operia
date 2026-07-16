import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { HomeDesignEditor } from '@/components/home-design-editor'
import {
  normalizeDesign,
  normalizeLayout,
  type HomeDesign,
  type TileLayoutItem,
} from '@/lib/home-tiles'
import { supabase } from '@/lib/supabase'

// Operia → Home-design: platformens standardopsætning af startsiden (Home).
// Hentes fra/gemmes på singleton-rækken platform_settings; hele produktkataloget
// er tilgængeligt. Den delte HomeDesignEditor står for selve redigeringen;
// kundens egen udgave (Konfigurér → Home-design) genbruger samme editor.
export const Route = createFileRoute('/_app/operia/home-design')({
  component: HomeDesignPage,
})

function useHomeConfig() {
  return useQuery({
    queryKey: ['platform-home-config'],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('home_tiles, home_design')
        .single()
      if (error) throw error
      return { tiles: normalizeLayout(data.home_tiles), design: normalizeDesign(data.home_design) }
    },
  })
}

function HomeDesignPage() {
  const { t } = useTranslation()
  const { data, isPending } = useHomeConfig()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const save = async (tiles: TileLayoutItem[], design: HomeDesign) => {
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({ home_tiles: tiles, home_design: design })
      .eq('id', true)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['platform-home-config'] })
    queryClient.invalidateQueries({ queryKey: ['platform-home-tiles'] })
    queryClient.invalidateQueries({ queryKey: ['home-config'] })
  }

  if (isPending || !data) return <Skeleton className="h-40 w-full" />

  return (
    <HomeDesignEditor
      title={t('homeDesignPage.title')}
      subtitle={t('homeDesignPage.subtitle')}
      baseTiles={data.tiles}
      baseDesign={data.design}
      saving={saving}
      onSave={save}
    />
  )
}

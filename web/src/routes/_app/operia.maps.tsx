import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'

// Edge-secret-navne pr. udbyder. Selve nøglerne ligger KUN som Supabase
// edge-secrets (sat via CLI/dashboard) og bruges server-side — de rører aldrig
// databasen eller browseren. maps-key-status-funktionen melder blot om de findes.
const SECRET_NAME: Record<MapsProvider, string> = {
  google: 'GOOGLE_MAPS_API_KEY',
  openrouteservice: 'ORS_API_KEY',
}

function useMapsKeyStatus() {
  return useQuery({
    queryKey: ['maps-key-status'],
    staleTime: 60 * 1000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('maps-key-status')
      if (error) throw error
      return data as { google: boolean; openrouteservice: boolean }
    },
  })
}

// Operia → Kort & ruter: platformens kort-/ruteudbyder til ruteplanlægning
// (platform_settings, singleton-række). OpenRouteService er standard (gratis,
// OSM-baseret); Google Maps kræver API-nøgle + faktureringskonto. Gemmes via
// samme fuldbredde-bjælke som de øvrige Operia-konfigurationssider.
export const Route = createFileRoute('/_app/operia/maps')({
  component: MapsPage,
})

type MapsProvider = 'google' | 'openrouteservice'

const PROVIDERS: { value: MapsProvider; labelKey: string; descKey: string }[] = [
  {
    value: 'openrouteservice',
    labelKey: 'operiaMapsPage.ors',
    descKey: 'operiaMapsPage.orsDesc',
  },
  {
    value: 'google',
    labelKey: 'operiaMapsPage.google',
    descKey: 'operiaMapsPage.googleDesc',
  },
]

function MapsPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformSettings()
  const { data: keyStatus, isPending: keyStatusPending } = useMapsKeyStatus()
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState<MapsProvider>('openrouteservice')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setProvider(data.maps_provider as MapsProvider)
  }, [data])

  const dirty = !!data && provider !== data.maps_provider

  const save = async () => {
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({ maps_provider: provider })
      .eq('id', true)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['platform-settings'] })
  }

  const cancel = () => {
    if (data) setProvider(data.maps_provider as MapsProvider)
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('operiaMapsPage.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">{t('operiaMapsPage.subtitle')}</p>
        </header>

        <RadioGroup
          value={provider}
          onValueChange={(v) => setProvider(v as MapsProvider)}
          className="max-w-xl gap-3"
        >
          {PROVIDERS.map((p) => (
            <label
              key={p.value}
              htmlFor={`maps-${p.value}`}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent/40"
            >
              <RadioGroupItem value={p.value} id={`maps-${p.value}`} className="mt-0.5" />
              <div>
                <p className="text-[13px] font-[450]">{t(p.labelKey)}</p>
                <p className="text-xs text-muted-foreground">{t(p.descKey)}</p>
              </div>
            </label>
          ))}
        </RadioGroup>

        <div className="mt-6 max-w-xl rounded-md border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-[450]">{t('operiaMapsPage.keyStatusLabel')}</p>
              <p className="font-mono text-xs text-muted-foreground">{SECRET_NAME[provider]}</p>
            </div>
            {keyStatusPending ? (
              <Skeleton className="h-5 w-24" />
            ) : keyStatus?.[provider] === undefined ? (
              <span className="text-xs text-muted-foreground">{t('operiaMapsPage.keyUnknown')}</span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    keyStatus[provider] ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                  )}
                />
                {t(keyStatus[provider] ? 'operiaMapsPage.keyConfigured' : 'operiaMapsPage.keyNotSet')}
              </span>
            )}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t('operiaMapsPage.keySecretHint')}</p>
          <code className="mt-2 block overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-[11px]">
            supabase secrets set {SECRET_NAME[provider]}=…
          </code>
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}

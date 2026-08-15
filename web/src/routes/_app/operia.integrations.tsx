import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SYNC_INTERVALS } from '@/lib/integrations'
import { AI_MODELS, AI_PROVIDERS, aiModelsFor } from '@/lib/ai'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { supabase } from '@/lib/supabase'

// Operia → Integrationer: hvilke eksterne systemer platformen udbyder, og hvad
// standardpolitikken er for nye kunder. Kunden sætter selv sine credentials på
// Konfigurér → Integrationer; her bestemmes kun om integrationen overhovedet
// findes, og hvad den arver.
export const Route = createFileRoute('/_app/operia/integrations')({
  component: IntegrationsPage,
})

// Listen er bevidst formet som skabelon-vælgeren på Operia → Skabeloner, så
// flere kan komme til uden at siden skal laves om.
const INTEGRATIONS = [
  { key: 'entra', labelKey: 'integrationsPage.entra' },
  { key: 'ai', labelKey: 'integrationsPage.ai' },
]

type Form = {
  enabled: boolean
  anonymizeRetired: boolean
  intervalMinutes: number
  aiEnabled: boolean
  aiProviders: string[]
  aiModels: string[]
}

// Holder arrays i katalog-orden, så dirty-sammenligningen (JSON.stringify)
// ikke ser forskel på samme udvalg i forskellig klikkerækkefølge.
function toggleKey(list: string[], key: string, order: string[]): string[] {
  const next = new Set(list)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return order.filter((k) => next.has(k))
}

function IntegrationsPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState('entra')
  const [form, setForm] = useState<Form>({
    enabled: false,
    anonymizeRetired: false,
    intervalMinutes: 1440,
    aiEnabled: false,
    aiProviders: [],
    aiModels: [],
  })
  const [saving, setSaving] = useState(false)

  const initial: Form | null = data
    ? {
        enabled: data.entra_enabled,
        anonymizeRetired: data.entra_anonymize_retired,
        intervalMinutes: data.entra_sync_interval_minutes,
        aiEnabled: data.ai_enabled,
        aiProviders: data.ai_providers ?? [],
        aiModels: data.ai_models ?? [],
      }
    : null

  useEffect(() => {
    if (initial) setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))
  const dirty = !!initial && JSON.stringify(form) !== JSON.stringify(initial)

  const save = async () => {
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({
        entra_enabled: form.enabled,
        entra_anonymize_retired: form.anonymizeRetired,
        entra_sync_interval_minutes: form.intervalMinutes,
        ai_enabled: form.aiEnabled,
        ai_providers: form.aiProviders,
        ai_models: form.aiModels,
      })
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

  if (isPending) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('integrationsPage.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">{t('integrationsPage.subtitle')}</p>
        </header>

        <div className="flex max-w-xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('integrationsPage.integration')}</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTEGRATIONS.map((i) => (
                  <SelectItem key={i.key} value={i.key}>
                    {t(i.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected === 'entra' && (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={form.enabled}
                    onCheckedChange={(v) => set({ enabled: v === true })}
                  />
                  <span>
                    <span className="text-[13px] font-[450]">{t('integrationsPage.enable')}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t('integrationsPage.enableDesc')}
                    </span>
                  </span>
                </label>
              </div>

              <div className="rounded-md border p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={form.anonymizeRetired}
                    onCheckedChange={(v) => set({ anonymizeRetired: v === true })}
                  />
                  <span>
                    <span className="text-[13px] font-[450]">
                      {t('integrationsPage.anonymizeRetired')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t('integrationsPage.anonymizeRetiredDesc')}
                    </span>
                  </span>
                </label>
                {form.anonymizeRetired && (
                  <p className="mt-3 flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
                    <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                    <span>{t('integrationsPage.anonymizeExplainer')}</span>
                  </p>
                )}
              </div>

              <div className="rounded-md border p-4">
                <Label className="text-label">{t('integrationsPage.syncInterval')}</Label>
                <Select
                  value={String(form.intervalMinutes)}
                  onValueChange={(v) => set({ intervalMinutes: Number(v) })}
                >
                  <SelectTrigger className="mt-2 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SYNC_INTERVALS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {t(`integrationsPage.interval_${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('integrationsPage.syncIntervalHint')}
                </p>
              </div>
            </div>
          )}

          {selected === 'ai' && (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={form.aiEnabled}
                    onCheckedChange={(v) => set({ aiEnabled: v === true })}
                  />
                  <span>
                    <span className="text-[13px] font-[450]">{t('integrationsPage.aiEnable')}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t('integrationsPage.aiEnableDesc')}
                    </span>
                  </span>
                </label>
              </div>

              <div className="rounded-md border p-4">
                <Label className="text-label">{t('integrationsPage.aiProviders')}</Label>
                <p className="mb-3 mt-1 text-xs text-muted-foreground">
                  {t('integrationsPage.aiProvidersDesc')}
                </p>
                <div className="flex flex-col gap-2">
                  {AI_PROVIDERS.map((p) => (
                    <label key={p.key} className="flex cursor-pointer items-center gap-3">
                      <Checkbox
                        checked={form.aiProviders.includes(p.key)}
                        onCheckedChange={() =>
                          set({
                            aiProviders: toggleKey(
                              form.aiProviders,
                              p.key,
                              AI_PROVIDERS.map((x) => x.key),
                            ),
                          })
                        }
                      />
                      <span className="text-[13px] font-[450]">{p.label}</span>
                      {aiModelsFor(p.key).length === 0 && (
                        <span className="text-xs text-muted-foreground">
                          {t('integrationsPage.aiNoModelsYet')}
                        </span>
                      )}
                      {p.hasFreeTier && (
                        <span className="text-xs text-amber-600 dark:text-amber-500">
                          {t('integrationsPage.aiFreeTier')}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                {AI_PROVIDERS.some((p) => p.hasFreeTier) && (
                  <p className="mt-3 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground-light">
                    <Info className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                    <span>{t('integrationsPage.aiFreeTierExplainer')}</span>
                  </p>
                )}
              </div>

              <div className="rounded-md border p-4">
                <Label className="text-label">{t('integrationsPage.aiModels')}</Label>
                <p className="mb-3 mt-1 text-xs text-muted-foreground">
                  {t('integrationsPage.aiModelsDesc')}
                </p>
                <div className="flex flex-col gap-4">
                  {AI_PROVIDERS.filter((p) => aiModelsFor(p.key).length > 0).map((p) => {
                    const providerOn = form.aiProviders.includes(p.key)
                    return (
                      <div key={p.key}>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {p.label}
                        </p>
                        <div className="flex flex-col gap-2">
                          {aiModelsFor(p.key).map((m) => (
                            <label
                              key={m.key}
                              className={
                                'flex items-center gap-3 ' +
                                (providerOn ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')
                              }
                            >
                              <Checkbox
                                disabled={!providerOn}
                                checked={form.aiModels.includes(m.key)}
                                onCheckedChange={() =>
                                  set({
                                    aiModels: toggleKey(
                                      form.aiModels,
                                      m.key,
                                      AI_MODELS.map((x) => x.key),
                                    ),
                                  })
                                }
                              />
                              <span className="text-[13px] font-[450]">{m.label}</span>
                              {!m.vision && (
                                <span className="text-xs text-muted-foreground">
                                  {t('integrationsPage.aiNoVision')}
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="mt-3 flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
                  <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                  <span>{t('integrationsPage.aiVisionExplainer')}</span>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => initial && setForm(initial)} disabled={saving}>
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

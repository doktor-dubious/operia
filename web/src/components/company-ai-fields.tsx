// Konfigurér → Integrationer → AI: kundens valg af udbyder (select) og model
// (radio), begrænset til platformens udvalg (Operia → Integrationer). Valget
// gemmes i company_ai_config; selve AI-kaldet sker server-side i edge-
// funktionen ai-read-label, som genchecker udvalget med DCA's egen API-nøgle.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AI_PROVIDERS, aiModelsFor } from '@/lib/ai'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

type Form = { provider: string; model: string }
const EMPTY: Form = { provider: '', model: '' }

export function CompanyAiFields({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: platform } = usePlatformSettings()
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)

  const { data, isPending } = useQuery({
    queryKey: ['company-ai', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_ai_config')
        .select('provider, model')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const initial: Form = data
    ? { provider: data.provider ?? '', model: data.model ?? '' }
    : EMPTY

  useEffect(() => {
    setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const allowedProviders = AI_PROVIDERS.filter((p) =>
    (platform?.ai_providers ?? []).includes(p.key),
  )
  const allowedModelsFor = (provider: string) =>
    aiModelsFor(provider).filter((m) => (platform?.ai_models ?? []).includes(m.key))

  const models = allowedModelsFor(form.provider)
  const selectedModel = models.find((m) => m.key === form.model)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  const save = async () => {
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('company_ai_config')
      .upsert(
        {
          company_id: companyId,
          provider: form.provider || null,
          model: form.model || null,
        },
        { onConflict: 'company_id' },
      )
      .select('company_id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-ai', companyId] })
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  if (allowedProviders.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('companyAi.noneOffered')}</p>
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-foreground-light">{t('companyAi.intro')}</p>

      <div className="rounded-md border p-4">
        <Label className="text-label">{t('companyAi.provider')}</Label>
        {/* Altid kontrolleret ('' = intet valg, placeholder vises) — skift
            mellem undefined og værdi udløser Radix' controlled-advarsel. */}
        <Select
          value={form.provider}
          onValueChange={(v) => {
            // Ny udbyder ⇒ modelvalget hører til den gamle og nulstilles.
            const first = allowedModelsFor(v)
            setForm({ provider: v, model: first.length === 1 ? first[0].key : '' })
          }}
        >
          <SelectTrigger className="mt-2 w-full">
            <SelectValue placeholder={t('companyAi.providerPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {allowedProviders.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {form.provider && (
        <div className="rounded-md border p-4">
          <Label className="text-label">{t('companyAi.model')}</Label>
          {models.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('companyAi.noModels')}</p>
          ) : (
            <RadioGroup
              className="mt-3 flex flex-col gap-2"
              value={form.model}
              onValueChange={(v) => setForm((f) => ({ ...f, model: v }))}
            >
              {models.map((m) => (
                <label key={m.key} className="flex cursor-pointer items-center gap-3">
                  <RadioGroupItem value={m.key} />
                  <span className="text-[13px] font-[450]">{m.label}</span>
                  {!m.vision && (
                    <span className="text-xs text-muted-foreground">
                      {t('companyAi.noVision')}
                    </span>
                  )}
                </label>
              ))}
            </RadioGroup>
          )}
          {selectedModel && !selectedModel.vision && (
            <p className="mt-3 flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
              <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
              <span>{t('companyAi.noVisionExplainer')}</span>
            </p>
          )}
        </div>
      )}

      {dirty && (
        <div className="flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={() => setForm(initial)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || (!!form.provider && !form.model)}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}

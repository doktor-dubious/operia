import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { AI_PROVIDERS, aiModelsFor } from '@/lib/ai'
import { supabase } from '@/lib/supabase'

// Operia → Generelt: platformens generelle indstillinger (platform_settings,
// singleton-række). Auto-refresh-intervallet + stykpriser for udsendte
// notifikationer (grundlaget for at fakturere kunder pr. e-mail/SMS — forbruget
// vises på Platform → Kunder → Forbrug) + stykpris pr. AI-labelaflæsning.
export const Route = createFileRoute('/_app/operia/general')({
  component: GeneralPage,
})

const MAX_SECONDS = 3600

// Priser indtastes med dansk decimalkomma eller punktum; numeric(10,4) i basen.
function parseCost(raw: string): number | null {
  const v = Number.parseFloat(raw.trim().replace(',', '.'))
  return Number.isFinite(v) && v >= 0 ? v : null
}

/** Sammenligning af pris-objekter må ikke afhænge af nøglernes rækkefølge. */
const sortedJson = (o: Record<string, number>) =>
  JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))))

function GeneralPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [interval, setIntervalValue] = useState('')
  const [emailCost, setEmailCost] = useState('')
  const [smsCost, setSmsCost] = useState('')
  // Pris pr. AI-model, som indtastet (rå streng pr. modelnøgle).
  const [aiCosts, setAiCosts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Kun det udvalg der faktisk er slået til på Operia → Integrationer: en pris
  // på en model, ingen kunde kan vælge, er kun forvirring.
  const aiRows = AI_PROVIDERS.map((provider) => ({
    provider,
    models: aiModelsFor(provider.key).filter((m) => (data?.ai_models ?? []).includes(m.key)),
  })).filter((r) => (data?.ai_providers ?? []).includes(r.provider.key) && r.models.length > 0)
  const aiModelKeys = aiRows.flatMap((r) => r.models.map((m) => m.key))
  const storedAiCosts = (data?.ai_model_costs ?? {}) as Record<string, number>

  useEffect(() => {
    if (data) {
      setIntervalValue(String(data.refresh_interval_seconds))
      setEmailCost(String(data.cost_per_email))
      setSmsCost(String(data.cost_per_sms))
      const stored = (data.ai_model_costs ?? {}) as Record<string, number>
      setAiCosts(Object.fromEntries(aiModelKeys.map((k) => [k, String(stored[k] ?? 0)])))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const parsed = Number.parseInt(interval, 10)
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_SECONDS
  const parsedEmailCost = parseCost(emailCost)
  const parsedSmsCost = parseCost(smsCost)
  const costsValid = parsedEmailCost != null && parsedSmsCost != null

  const parsedAiCosts = aiModelKeys.map((k) => parseCost(aiCosts[k] ?? '0'))
  const aiCostsValid = parsedAiCosts.every((v) => v != null)
  // 0 = modellen faktureres ikke, og gemmes som fravær af nøglen frem for et
  // nul — så en model der aldrig har fået en pris, heller ikke gør siden
  // "ændret" i det øjeblik den bliver slået til på Integrationer.
  const nextAiCosts: Record<string, number> = { ...storedAiCosts }
  aiModelKeys.forEach((k, i) => {
    const v = parsedAiCosts[i]
    if (v == null) return
    if (v === 0) delete nextAiCosts[k]
    else nextAiCosts[k] = v
  })

  const dirty =
    !!data &&
    valid &&
    costsValid &&
    aiCostsValid &&
    (parsed !== data.refresh_interval_seconds ||
      parsedEmailCost !== data.cost_per_email ||
      parsedSmsCost !== data.cost_per_sms ||
      sortedJson(nextAiCosts) !== sortedJson(storedAiCosts))

  const save = async () => {
    if (!valid || !costsValid || !aiCostsValid) return
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({
        refresh_interval_seconds: parsed,
        cost_per_email: parsedEmailCost!,
        cost_per_sms: parsedSmsCost!,
        ai_model_costs: nextAiCosts,
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
    queryClient.invalidateQueries({ queryKey: ['refresh-interval'] })
  }

  const cancel = () => {
    if (data) {
      setIntervalValue(String(data.refresh_interval_seconds))
      setEmailCost(String(data.cost_per_email))
      setSmsCost(String(data.cost_per_sms))
      setAiCosts(Object.fromEntries(aiModelKeys.map((k) => [k, String(storedAiCosts[k] ?? 0)])))
    }
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('operiaGeneralPage.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">{t('operiaGeneralPage.subtitle')}</p>
        </header>

        <div className="max-w-xl rounded-md border p-4">
          <Label htmlFor="refresh-interval" className="text-[13px] font-[450]">
            {t('operiaGeneralPage.refreshInterval')}
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('operiaGeneralPage.refreshIntervalHint')}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Input
              id="refresh-interval"
              type="number"
              min={0}
              max={MAX_SECONDS}
              step={1}
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value)}
              className="w-28"
              aria-invalid={!valid}
            />
            <span className="text-sm text-muted-foreground">{t('operiaGeneralPage.seconds')}</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {parsed === 0
              ? t('operiaGeneralPage.disabledHint')
              : t('operiaGeneralPage.rangeHint', { max: MAX_SECONDS })}
          </p>
        </div>

        {/* Stykpriser for notifikationer — driver beløbene på kundernes
            Forbrug-fane. 0 = der faktureres ikke for kanalen. */}
        <div className="mt-6 max-w-xl rounded-md border p-4">
          <p className="text-[13px] font-[450]">{t('operiaGeneralPage.notifyCosts')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('operiaGeneralPage.notifyCostsHint')}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="cost-email" className="text-[13px] font-[450]">
                {t('operiaGeneralPage.costPerEmail')}
              </Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="cost-email"
                  inputMode="decimal"
                  value={emailCost}
                  onChange={(e) => setEmailCost(e.target.value)}
                  className="w-28"
                  aria-invalid={parsedEmailCost == null}
                />
                <span className="text-sm text-muted-foreground">
                  {t('operiaGeneralPage.costUnit')}
                </span>
              </div>
            </div>
            <div>
              <Label htmlFor="cost-sms" className="text-[13px] font-[450]">
                {t('operiaGeneralPage.costPerSms')}
              </Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="cost-sms"
                  inputMode="decimal"
                  value={smsCost}
                  onChange={(e) => setSmsCost(e.target.value)}
                  className="w-28"
                  aria-invalid={parsedSmsCost == null}
                />
                <span className="text-sm text-muted-foreground">
                  {t('operiaGeneralPage.costUnit')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stykpris pr. AI-labelaflæsning. Prisen sættes pr. MODEL, fordi
            udbydernes egne priser er vidt forskellige pr. model — og kun for
            det udvalg der er slået til på Operia → Integrationer. */}
        <div className="mt-6 max-w-xl rounded-md border p-4">
          <p className="text-[13px] font-[450]">{t('operiaGeneralPage.aiCosts')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('operiaGeneralPage.aiCostsHint')}
          </p>
          {aiRows.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {data?.ai_enabled
                ? t('operiaGeneralPage.aiCostsEmpty')
                : t('operiaGeneralPage.aiCostsDisabled')}
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {aiRows.map(({ provider, models }) => (
                <div key={provider.key}>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {provider.label}
                  </p>
                  <div className="mt-2 flex flex-col gap-2">
                    {models.map((m) => (
                      <div key={m.key} className="flex items-center gap-2">
                        <Label
                          htmlFor={`cost-${m.key}`}
                          className="flex-1 text-[13px] font-[450]"
                        >
                          {m.label}
                        </Label>
                        <Input
                          id={`cost-${m.key}`}
                          inputMode="decimal"
                          value={aiCosts[m.key] ?? ''}
                          onChange={(e) =>
                            setAiCosts((c) => ({ ...c, [m.key]: e.target.value }))
                          }
                          className="w-28"
                          aria-invalid={parseCost(aiCosts[m.key] ?? '0') == null}
                        />
                        <span className="w-32 text-sm text-muted-foreground">
                          {t('operiaGeneralPage.aiCostUnit')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving || !valid || !costsValid || !aiCostsValid}
          >
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}

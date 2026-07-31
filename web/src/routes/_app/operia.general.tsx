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
import { supabase } from '@/lib/supabase'

// Operia → Generelt: platformens generelle indstillinger (platform_settings,
// singleton-række). Auto-refresh-intervallet + stykpriser for udsendte
// notifikationer (grundlaget for at fakturere kunder pr. e-mail/SMS — forbruget
// vises på Platform → Kunder → Forbrug).
export const Route = createFileRoute('/_app/operia/general')({
  component: GeneralPage,
})

const MAX_SECONDS = 3600

// Priser indtastes med dansk decimalkomma eller punktum; numeric(10,4) i basen.
function parseCost(raw: string): number | null {
  const v = Number.parseFloat(raw.trim().replace(',', '.'))
  return Number.isFinite(v) && v >= 0 ? v : null
}

function GeneralPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [interval, setIntervalValue] = useState('')
  const [emailCost, setEmailCost] = useState('')
  const [smsCost, setSmsCost] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) {
      setIntervalValue(String(data.refresh_interval_seconds))
      setEmailCost(String(data.cost_per_email))
      setSmsCost(String(data.cost_per_sms))
    }
  }, [data])

  const parsed = Number.parseInt(interval, 10)
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_SECONDS
  const parsedEmailCost = parseCost(emailCost)
  const parsedSmsCost = parseCost(smsCost)
  const costsValid = parsedEmailCost != null && parsedSmsCost != null
  const dirty =
    !!data &&
    valid &&
    costsValid &&
    (parsed !== data.refresh_interval_seconds ||
      parsedEmailCost !== data.cost_per_email ||
      parsedSmsCost !== data.cost_per_sms)

  const save = async () => {
    if (!valid || !costsValid) return
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({
        refresh_interval_seconds: parsed,
        cost_per_email: parsedEmailCost!,
        cost_per_sms: parsedSmsCost!,
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
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !valid || !costsValid}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}

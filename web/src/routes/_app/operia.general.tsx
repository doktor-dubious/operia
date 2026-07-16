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
// singleton-række). Foreløbig kun auto-refresh-intervallet — hvor ofte
// klienterne automatisk genhenter data fra databasen (0 = slået fra).
export const Route = createFileRoute('/_app/operia/general')({
  component: GeneralPage,
})

const MAX_SECONDS = 3600

function GeneralPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [interval, setIntervalValue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setIntervalValue(String(data.refresh_interval_seconds))
  }, [data])

  const parsed = Number.parseInt(interval, 10)
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_SECONDS
  const dirty = !!data && valid && parsed !== data.refresh_interval_seconds

  const save = async () => {
    if (!valid) return
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({ refresh_interval_seconds: parsed })
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
    if (data) setIntervalValue(String(data.refresh_interval_seconds))
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
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !valid}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}

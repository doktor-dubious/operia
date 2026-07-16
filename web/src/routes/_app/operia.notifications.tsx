import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ParcelFlowFields, QuietHoursField } from '@/components/company-config-fields'
import { Field } from '@/components/detail-field'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { supabase } from '@/lib/supabase'

// Operia → Notifikationer: platformens standarder — generelt (stilletid) og
// pr. notifikationstype (indtil videre kun pakkeflowets to påmindelser).
// Virksomheder kan override værdierne på Konfigurér → Notifikationer.
export const Route = createFileRoute('/_app/operia/notifications')({
  component: NotificationsPage,
})

type Values = {
  quietStart: string
  quietEnd: string
  r1Enabled: boolean
  r2Enabled: boolean
  reminder1: number
  reminder2: number
  maxReminders: number
}

function NotificationsPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Values | null>(null)
  const [notifType, setNotifType] = useState('parcel_flow')
  const [saving, setSaving] = useState(false)

  const toValues = (row: NonNullable<typeof data>): Values => ({
    quietStart: row.quiet_hours_start?.slice(0, 5) ?? '',
    quietEnd: row.quiet_hours_end?.slice(0, 5) ?? '',
    r1Enabled: row.parcel_reminder_1_enabled,
    r2Enabled: row.parcel_reminder_2_enabled,
    reminder1: row.parcel_reminder_1_days,
    reminder2: row.parcel_reminder_2_days,
    maxReminders: row.parcel_reminder_max,
  })

  useEffect(() => {
    if (data) setValues(toValues(data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const initial = data ? toValues(data) : null
  const dirty =
    !!values &&
    !!initial &&
    (values.quietStart !== initial.quietStart ||
      values.quietEnd !== initial.quietEnd ||
      values.r1Enabled !== initial.r1Enabled ||
      values.r2Enabled !== initial.r2Enabled ||
      values.reminder1 !== initial.reminder1 ||
      values.reminder2 !== initial.reminder2 ||
      values.maxReminders !== initial.maxReminders)

  const save = async () => {
    if (!values) return
    // Påmindelse 2 skal ligge mindst én dag efter påmindelse 1.
    const r1 = Math.max(1, Math.round(values.reminder1))
    const r2 = Math.max(r1 + 1, Math.round(values.reminder2))
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({
        quiet_hours_start: values.quietStart || null,
        quiet_hours_end: values.quietEnd || null,
        parcel_reminder_1_days: r1,
        parcel_reminder_2_days: r2,
        parcel_reminder_max: Math.max(0, Math.round(values.maxReminders)),
        parcel_reminder_1_enabled: values.r1Enabled,
        parcel_reminder_2_enabled: values.r1Enabled && values.r2Enabled,
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

  const cancel = () => {
    if (data) setValues(toValues(data))
  }

  if (isPending || !values) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">
            {t('notificationsPage.title')}
          </h1>
          <p className="mt-1 text-sm text-foreground-light">
            {t('notificationsPage.subtitlePlatform')}
          </p>
        </header>

        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-4 border-b border-border pb-8">
            <h2 className="text-[13px] font-semibold">{t('notificationsPage.general')}</h2>
            <QuietHoursField
              start={values.quietStart}
              end={values.quietEnd}
              onStartChange={(v) => setValues({ ...values, quietStart: v })}
              onEndChange={(v) => setValues({ ...values, quietEnd: v })}
            />
          </section>

          <section className="flex flex-col gap-5">
            <Field label={t('notificationsPage.type')}>
              <Select value={notifType} onValueChange={setNotifType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parcel_flow">
                    {t('notificationsPage.typeParcelFlow')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {notifType === 'parcel_flow' && (
              <ParcelFlowFields
                value={values}
                onChange={(patch) => setValues({ ...values, ...patch })}
              />
            )}
          </section>
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

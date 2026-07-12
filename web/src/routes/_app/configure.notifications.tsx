import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useCompanyContext } from '@/hooks/use-company-context'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { supabase } from '@/lib/supabase'

// Konfigurér → Notifikationer: virksomhedens indstillinger. Stilletiden er
// virksomhedens egen (flyttet hertil fra Lokalisering); pakkeflowets
// påmindelsesdage arver platformens standard, indtil virksomheden gemmer
// sine egne (null i companies = arv). Nulstil fjerner virksomhedens egne.
export const Route = createFileRoute('/_app/configure/notifications')({
  component: NotificationsPage,
})

function useCompanyNotifications(companyId: string | null) {
  return useQuery({
    queryKey: ['company-notifications', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('quiet_hours_start, quiet_hours_end, parcel_reminder_1_days, parcel_reminder_2_days, parcel_reminder_max, parcel_reminder_1_enabled, parcel_reminder_2_enabled')
        .eq('id', companyId!)
        .single()
      if (error) throw error
      return data
    },
  })
}

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
  const { companyId } = useCompanyContext()
  const { data, isPending } = useCompanyNotifications(companyId)
  const { data: platform } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Values | null>(null)
  const [notifType, setNotifType] = useState('parcel_flow')
  const [saving, setSaving] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  // Effektive værdier: virksomhedens egne, ellers platformens standard.
  const savedR1 = data?.parcel_reminder_1_days ?? platform?.parcel_reminder_1_days ?? 3
  const savedR2 = data?.parcel_reminder_2_days ?? platform?.parcel_reminder_2_days ?? 7
  const savedMax = data?.parcel_reminder_max ?? platform?.parcel_reminder_max ?? 0
  const savedR1On = data?.parcel_reminder_1_enabled ?? platform?.parcel_reminder_1_enabled ?? true
  const savedR2On = data?.parcel_reminder_2_enabled ?? platform?.parcel_reminder_2_enabled ?? true
  const overridden =
    data?.parcel_reminder_1_days != null ||
    data?.parcel_reminder_2_days != null ||
    data?.parcel_reminder_max != null ||
    data?.parcel_reminder_1_enabled != null ||
    data?.parcel_reminder_2_enabled != null

  const toValues = (row: NonNullable<typeof data>): Values => ({
    quietStart: row.quiet_hours_start?.slice(0, 5) ?? '',
    quietEnd: row.quiet_hours_end?.slice(0, 5) ?? '',
    r1Enabled: savedR1On,
    r2Enabled: savedR2On,
    reminder1: savedR1,
    reminder2: savedR2,
    maxReminders: savedMax,
  })

  useEffect(() => {
    if (data && platform) setValues(toValues(data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, platform])

  const initial = data && platform ? toValues(data) : null
  const remindersDirty =
    !!values && !!initial && (values.r1Enabled !== initial.r1Enabled ||
      values.r2Enabled !== initial.r2Enabled ||
      values.reminder1 !== initial.reminder1 ||
      values.reminder2 !== initial.reminder2 ||
      values.maxReminders !== initial.maxReminders)
  const dirty =
    !!values &&
    !!initial &&
    (values.quietStart !== initial.quietStart ||
      values.quietEnd !== initial.quietEnd ||
      remindersDirty)

  const save = async () => {
    if (!values || !companyId) return
    const r1 = Math.max(1, Math.round(values.reminder1))
    const r2 = Math.max(r1 + 1, Math.round(values.reminder2))
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('companies')
      .update({
        quiet_hours_start: values.quietStart || null,
        quiet_hours_end: values.quietEnd || null,
        // Påmindelserne bliver kun virksomhedens egne hvis de er ændret
        // (eller allerede var det) — ellers fortsætter arven fra platformen.
        ...(remindersDirty || overridden
          ? {
              parcel_reminder_1_days: r1,
              parcel_reminder_2_days: r2,
              parcel_reminder_max: Math.max(0, Math.round(values.maxReminders)),
              parcel_reminder_1_enabled: values.r1Enabled,
              parcel_reminder_2_enabled: values.r1Enabled && values.r2Enabled,
            }
          : {}),
      })
      .eq('id', companyId)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-notifications', companyId] })
  }

  const cancel = () => {
    if (data && platform) setValues(toValues(data))
  }

  // Nulstil: fjern virksomhedens egne påmindelsesdage → platformens gælder.
  const reset = async () => {
    if (!companyId) return
    const { data: saved, error } = await supabase
      .from('companies')
      .update({
        parcel_reminder_1_days: null,
        parcel_reminder_2_days: null,
        parcel_reminder_max: null,
        parcel_reminder_1_enabled: null,
        parcel_reminder_2_enabled: null,
      })
      .eq('id', companyId)
      .select('id')
    if (error || !saved?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    setResetOpen(false)
    toast.success(t('configureConfig.notifResetToast'))
    queryClient.invalidateQueries({ queryKey: ['company-notifications', companyId] })
  }

  if (isPending || !values || !companyId) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">
            {t('notificationsPage.title')}
          </h1>
          <p className="mt-1 text-sm text-foreground-light">
            {t('notificationsPage.subtitleCompany')}
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
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {overridden
                      ? t('configureConfig.templateCustomized')
                      : t('configureConfig.templateUsesDefault')}
                  </p>
                  {overridden && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setResetOpen(true)}
                    >
                      {t('configureConfig.resetToDefault')}
                    </Button>
                  )}
                </div>
                <ParcelFlowFields
                  value={values}
                  onChange={(patch) => setValues({ ...values, ...patch })}
                />
              </>
            )}
          </section>
        </div>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('configureConfig.notifResetTitle')}</DialogTitle>
            <DialogDescription>{t('configureConfig.notifResetDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={reset}>
              {t('configureConfig.resetConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

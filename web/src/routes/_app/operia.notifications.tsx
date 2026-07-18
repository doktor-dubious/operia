import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AssetFlowFields,
  ChannelToggles,
  ParcelFlowFields,
  QuietHoursField,
  type ParcelFlowValue,
} from '@/components/company-config-fields'
import { Field } from '@/components/detail-field'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { supabase } from '@/lib/supabase'

// Operia → Notifikationer: platformens standarder — generelt (stilletid,
// hovedafbrydere, kanaler) og pr. notifikationstype (pakkeflow + aktiv-
// påmindelser). Virksomheder kan override værdierne på Konfigurér →
// Notifikationer.
export const Route = createFileRoute('/_app/operia/notifications')({
  component: NotificationsPage,
})

type Values = {
  quietStart: string
  quietEnd: string
  parcelEnabled: boolean
  assetEnabled: boolean
  emailEnabled: boolean
  smsEnabled: boolean
  parcel: ParcelFlowValue
  asset: ParcelFlowValue
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
    parcelEnabled: row.parcel_notifications_enabled,
    assetEnabled: row.asset_notifications_enabled,
    emailEnabled: row.notify_email_enabled,
    smsEnabled: row.notify_sms_enabled,
    parcel: {
      r1Enabled: row.parcel_reminder_1_enabled,
      r2Enabled: row.parcel_reminder_2_enabled,
      reminder1: row.parcel_reminder_1_days,
      reminder2: row.parcel_reminder_2_days,
      maxReminders: row.parcel_reminder_max,
    },
    asset: {
      r1Enabled: row.asset_reminder_1_enabled,
      r2Enabled: row.asset_reminder_2_enabled,
      reminder1: row.asset_reminder_1_days,
      reminder2: row.asset_reminder_2_days,
      maxReminders: row.asset_reminder_max,
    },
  })

  useEffect(() => {
    if (data) setValues(toValues(data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const initial = data ? toValues(data) : null
  const dirty = !!values && !!initial && JSON.stringify(values) !== JSON.stringify(initial)

  const save = async () => {
    if (!values) return
    // Påmindelse 2 skal ligge mindst én dag efter påmindelse 1.
    const p = values.parcel
    const a = values.asset
    const pr1 = Math.max(1, Math.round(p.reminder1))
    const pr2 = Math.max(pr1 + 1, Math.round(p.reminder2))
    const ar1 = Math.max(1, Math.round(a.reminder1))
    const ar2 = Math.max(ar1 + 1, Math.round(a.reminder2))
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({
        quiet_hours_start: values.quietStart || null,
        quiet_hours_end: values.quietEnd || null,
        parcel_notifications_enabled: values.parcelEnabled,
        asset_notifications_enabled: values.assetEnabled,
        notify_email_enabled: values.emailEnabled,
        notify_sms_enabled: values.smsEnabled,
        parcel_reminder_1_days: pr1,
        parcel_reminder_2_days: pr2,
        parcel_reminder_max: Math.max(0, Math.round(p.maxReminders)),
        parcel_reminder_1_enabled: p.r1Enabled,
        parcel_reminder_2_enabled: p.r1Enabled && p.r2Enabled,
        asset_reminder_1_days: ar1,
        asset_reminder_2_days: ar2,
        asset_reminder_max: Math.max(0, Math.round(a.maxReminders)),
        asset_reminder_1_enabled: a.r1Enabled,
        asset_reminder_2_enabled: a.r1Enabled && a.r2Enabled,
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

            <Field
              label={t('notificationsPage.activation')}
              info={t('notificationsPage.activationHint')}
            >
              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="enable-parcel" className="px-2.5 py-1.5 font-normal">
                  <Checkbox
                    id="enable-parcel"
                    checked={values.parcelEnabled}
                    onCheckedChange={(v) => setValues({ ...values, parcelEnabled: v === true })}
                  />
                  {t('notificationsPage.enableParcel')}
                </FieldLabel>
                <FieldLabel htmlFor="enable-asset" className="px-2.5 py-1.5 font-normal">
                  <Checkbox
                    id="enable-asset"
                    checked={values.assetEnabled}
                    onCheckedChange={(v) => setValues({ ...values, assetEnabled: v === true })}
                  />
                  {t('notificationsPage.enableAsset')}
                </FieldLabel>
              </div>
            </Field>

            <ChannelToggles
              email={values.emailEnabled}
              sms={values.smsEnabled}
              onEmailChange={(v) => setValues({ ...values, emailEnabled: v })}
              onSmsChange={(v) => setValues({ ...values, smsEnabled: v })}
            />

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
                  <SelectItem value="asset_reminder">
                    {t('notificationsPage.typeAssetReminder')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {notifType === 'parcel_flow' && (
              <ParcelFlowFields
                value={values.parcel}
                onChange={(patch) =>
                  setValues({ ...values, parcel: { ...values.parcel, ...patch } })
                }
              />
            )}
            {notifType === 'asset_reminder' && (
              <>
                <p className="text-xs text-muted-foreground">
                  {t('notificationsPage.assetFirstNotice')}
                </p>
                <AssetFlowFields
                  value={values.asset}
                  onChange={(patch) =>
                    setValues({ ...values, asset: { ...values.asset, ...patch } })
                  }
                />
              </>
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

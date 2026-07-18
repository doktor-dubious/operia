import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { MessageSquare } from 'lucide-react'
import {
  AssetFlowFields,
  ChannelToggles,
  ParcelFlowFields,
  QuietHoursField,
  type ParcelFlowValue,
} from '@/components/company-config-fields'
import { Field } from '@/components/detail-field'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { supabase } from '@/lib/supabase'

// Konfigurér → Notifikationer: virksomhedens indstillinger. Stilletiden og
// kanalerne er virksomhedens egne; påmindelserne (pakke + aktiv) arver
// platformens standard, indtil virksomheden gemmer sine egne (null i companies
// = arv). Nulstil fjerner virksomhedens egne for den valgte type.
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
        .select(
          'quiet_hours_start, quiet_hours_end, notify_email_enabled, notify_sms_enabled, parcel_reminder_1_days, parcel_reminder_2_days, parcel_reminder_max, parcel_reminder_1_enabled, parcel_reminder_2_enabled, asset_reminder_1_days, asset_reminder_2_days, asset_reminder_max, asset_reminder_1_enabled, asset_reminder_2_enabled',
        )
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
  emailEnabled: boolean
  smsEnabled: boolean
  parcel: ParcelFlowValue
  asset: ParcelFlowValue
}

function NotificationsPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data: access } = useAccess()
  const { data, isPending } = useCompanyNotifications(companyId)
  const { data: platform } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Values | null>(null)
  const [notifType, setNotifType] = useState('parcel_flow')
  const [saving, setSaving] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [testPhone, setTestPhone] = useState('')
  const [testSending, setTestSending] = useState(false)

  // Effektive værdier: virksomhedens egne, ellers platformens standard.
  const toValues = (row: NonNullable<typeof data>, p: NonNullable<typeof platform>): Values => ({
    quietStart: row.quiet_hours_start?.slice(0, 5) ?? '',
    quietEnd: row.quiet_hours_end?.slice(0, 5) ?? '',
    emailEnabled: row.notify_email_enabled ?? p.notify_email_enabled,
    smsEnabled: row.notify_sms_enabled ?? p.notify_sms_enabled,
    parcel: {
      r1Enabled: row.parcel_reminder_1_enabled ?? p.parcel_reminder_1_enabled,
      r2Enabled: row.parcel_reminder_2_enabled ?? p.parcel_reminder_2_enabled,
      reminder1: row.parcel_reminder_1_days ?? p.parcel_reminder_1_days,
      reminder2: row.parcel_reminder_2_days ?? p.parcel_reminder_2_days,
      maxReminders: row.parcel_reminder_max ?? p.parcel_reminder_max,
    },
    asset: {
      r1Enabled: row.asset_reminder_1_enabled ?? p.asset_reminder_1_enabled,
      r2Enabled: row.asset_reminder_2_enabled ?? p.asset_reminder_2_enabled,
      reminder1: row.asset_reminder_1_days ?? p.asset_reminder_1_days,
      reminder2: row.asset_reminder_2_days ?? p.asset_reminder_2_days,
      maxReminders: row.asset_reminder_max ?? p.asset_reminder_max,
    },
  })

  useEffect(() => {
    if (data && platform) setValues(toValues(data, platform))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, platform])

  // Har virksomheden allerede en override for gruppen? (styrer "tilpasset"-note
  // + nulstil, og at gemning bevarer en eksisterende override.)
  const parcelOverridden =
    !!data &&
    (data.parcel_reminder_1_days != null ||
      data.parcel_reminder_2_days != null ||
      data.parcel_reminder_max != null ||
      data.parcel_reminder_1_enabled != null ||
      data.parcel_reminder_2_enabled != null)
  const assetOverridden =
    !!data &&
    (data.asset_reminder_1_days != null ||
      data.asset_reminder_2_days != null ||
      data.asset_reminder_max != null ||
      data.asset_reminder_1_enabled != null ||
      data.asset_reminder_2_enabled != null)
  const channelsOverridden =
    !!data && (data.notify_email_enabled != null || data.notify_sms_enabled != null)

  const initial = data && platform ? toValues(data, platform) : null
  const j = (o: unknown) => JSON.stringify(o)
  const parcelDirty = !!values && !!initial && j(values.parcel) !== j(initial.parcel)
  const assetDirty = !!values && !!initial && j(values.asset) !== j(initial.asset)
  const channelsDirty =
    !!values &&
    !!initial &&
    (values.emailEnabled !== initial.emailEnabled || values.smsEnabled !== initial.smsEnabled)
  const quietDirty =
    !!values &&
    !!initial &&
    (values.quietStart !== initial.quietStart || values.quietEnd !== initial.quietEnd)
  const dirty = parcelDirty || assetDirty || channelsDirty || quietDirty

  const save = async () => {
    if (!values || !companyId) return
    const p = values.parcel
    const a = values.asset
    const pr1 = Math.max(1, Math.round(p.reminder1))
    const pr2 = Math.max(pr1 + 1, Math.round(p.reminder2))
    const ar1 = Math.max(1, Math.round(a.reminder1))
    const ar2 = Math.max(ar1 + 1, Math.round(a.reminder2))
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('companies')
      .update({
        quiet_hours_start: values.quietStart || null,
        quiet_hours_end: values.quietEnd || null,
        ...(channelsDirty || channelsOverridden
          ? { notify_email_enabled: values.emailEnabled, notify_sms_enabled: values.smsEnabled }
          : {}),
        // Påmindelserne bliver kun virksomhedens egne hvis de er ændret (eller
        // allerede var det) — ellers fortsætter arven fra platformen.
        ...(parcelDirty || parcelOverridden
          ? {
              parcel_reminder_1_days: pr1,
              parcel_reminder_2_days: pr2,
              parcel_reminder_max: Math.max(0, Math.round(p.maxReminders)),
              parcel_reminder_1_enabled: p.r1Enabled,
              parcel_reminder_2_enabled: p.r1Enabled && p.r2Enabled,
            }
          : {}),
        ...(assetDirty || assetOverridden
          ? {
              asset_reminder_1_days: ar1,
              asset_reminder_2_days: ar2,
              asset_reminder_max: Math.max(0, Math.round(a.maxReminders)),
              asset_reminder_1_enabled: a.r1Enabled,
              asset_reminder_2_enabled: a.r1Enabled && a.r2Enabled,
            }
          : {}),
      })
      .eq('id', companyId)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-notifications', companyId] })
  }

  const cancel = () => {
    if (data && platform) setValues(toValues(data, platform))
  }

  // Nulstil den valgte types påmindelser → platformens standard gælder igen.
  const reset = async () => {
    if (!companyId) return
    const patch =
      notifType === 'asset_reminder'
        ? {
            asset_reminder_1_days: null,
            asset_reminder_2_days: null,
            asset_reminder_max: null,
            asset_reminder_1_enabled: null,
            asset_reminder_2_enabled: null,
          }
        : {
            parcel_reminder_1_days: null,
            parcel_reminder_2_days: null,
            parcel_reminder_max: null,
            parcel_reminder_1_enabled: null,
            parcel_reminder_2_enabled: null,
          }
    const { data: saved, error } = await supabase
      .from('companies')
      .update(patch)
      .eq('id', companyId)
      .select('id')
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    setResetOpen(false)
    toast.success(t('configureConfig.notifResetToast'))
    queryClient.invalidateQueries({ queryKey: ['company-notifications', companyId] })
  }

  // Test-SMS: sender via edge-funktionen send-test-sms (som genverificerer
  // rollen server-side og bruger GATEWAYAPI_TOKEN). Rører ingen indstillinger.
  const sendTest = async () => {
    const phone = testPhone.trim()
    if (!phone) return
    setTestSending(true)
    const { data: res, error } = await supabase.functions.invoke('send-test-sms', {
      body: { phone },
    })
    setTestSending(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    if (res?.ok) {
      toast.success(t('notificationsPage.testSmsOk'))
    } else {
      toast.error(t('notificationsPage.testSmsFail', { error: res?.error ?? 'unknown' }))
    }
  }

  if (isPending || !values || !companyId) return <Skeleton className="h-40 w-full" />

  const activeOverridden = notifType === 'asset_reminder' ? assetOverridden : parcelOverridden

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

            {access?.isPlatformAdmin && (
              <Field label={t('notificationsPage.testSms')}>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t('notificationsPage.testSmsHint')}
                </p>
                <div className="flex gap-2">
                  <Input
                    value={testPhone}
                    inputMode="tel"
                    autoComplete="off"
                    placeholder={t('notificationsPage.testSmsPlaceholder')}
                    onChange={(e) => setTestPhone(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        sendTest()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={testSending || !testPhone.trim()}
                    onClick={sendTest}
                  >
                    <MessageSquare className="size-4" />
                    {testSending ? t('common.loading') : t('notificationsPage.testSmsButton')}
                  </Button>
                </div>
              </Field>
            )}
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

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {activeOverridden
                  ? t('configureConfig.templateCustomized')
                  : t('configureConfig.templateUsesDefault')}
              </p>
              {activeOverridden && (
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

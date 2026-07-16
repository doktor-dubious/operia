import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Check, Clock, FolderInput, Mail, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { TimePicker } from '@/components/time-picker'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Standard-klokkeslæt når planlagt import slås til uden et gemt tidspunkt.
const DEFAULT_SCHEDULE_TIME = '09:00'

// Operia → Dataoverførsel: hvilke ingest-kanaler platformen udbyder (SFTP,
// automatisk e-mail) + deres fælles adresser. Kunder kan kun slå de kanaler til,
// som er aktiveret her. Selve SFTP-gateway'en/e-mail-modtageren kører uden for
// Supabase; denne side konfigurerer blot adresserne.
export const Route = createFileRoute('/_app/operia/data-transfer')({
  component: DataTransferPage,
})

type Form = {
  sftpEnabled: boolean
  sftpHost: string
  emailEnabled: boolean
  emailBaseDomain: string
  antispoofEnabled: boolean
  antispoofStrict: boolean
  allowlistRequired: boolean
  scheduleEnabled: boolean
  scheduleTime: string
}

// En kompakt switch-række (label + hint til venstre, switch til højre), brugt
// til e-mailens sikkerhedskontakter. `indent` viser afhængige valg forskudt.
function SwitchRow({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  recommended = false,
  indent = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
  disabled?: boolean
  recommended?: boolean
  indent?: boolean
}) {
  const { t } = useTranslation()
  return (
    <label
      className={cn(
        'flex items-start justify-between gap-3',
        indent && 'pl-4',
        disabled && 'opacity-50',
      )}
    >
      <span>
        <span className="text-[13px] font-[450]">
          {label}
          {recommended && (
            <span className="ml-1.5 text-xs font-normal text-status-good-to-neutral">
              {t('dataTransferPage.recommended')}
            </span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
    </label>
  )
}

function DataTransferPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Form>({
    sftpEnabled: false,
    sftpHost: '',
    emailEnabled: false,
    emailBaseDomain: '',
    antispoofEnabled: true,
    antispoofStrict: false,
    allowlistRequired: true,
    scheduleEnabled: false,
    scheduleTime: DEFAULT_SCHEDULE_TIME,
  })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  // Resultat af sidste forbindelsestest (nulstilles når adressen ændres).
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null)

  const initial: Form | null = data
    ? {
        sftpEnabled: data.sftp_enabled,
        sftpHost: data.sftp_host ?? '',
        emailEnabled: data.email_enabled,
        emailBaseDomain: data.email_base_domain ?? '',
        antispoofEnabled: data.email_antispoof_enabled,
        antispoofStrict: data.email_antispoof_strict,
        allowlistRequired: data.email_allowlist_required,
        scheduleEnabled: data.import_schedule_enabled,
        scheduleTime: data.import_schedule_time?.slice(0, 5) || DEFAULT_SCHEDULE_TIME,
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
        sftp_enabled: form.sftpEnabled,
        sftp_host: form.sftpHost.trim() || null,
        email_enabled: form.emailEnabled,
        email_base_domain: form.emailBaseDomain.trim() || null,
        email_antispoof_enabled: form.antispoofEnabled,
        email_antispoof_strict: form.antispoofStrict,
        email_allowlist_required: form.allowlistRequired,
        import_schedule_enabled: form.scheduleEnabled,
        import_schedule_time: form.scheduleTime || null,
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

  const testConnection = async () => {
    const host = form.sftpHost.trim()
    if (!host) return
    setTesting(true)
    const { data: res, error } = await supabase.functions.invoke('sftp-test', { body: { host } })
    setTesting(false)
    if (error) {
      setTestResult('fail')
      toast.error(describeError(error, t))
      return
    }
    if (res?.ok) {
      setTestResult('ok')
      toast.success(t('dataTransferPage.testOk', { ms: res.ms }))
    } else {
      setTestResult('fail')
      toast.error(t(`dataTransferPage.test_${res?.reason ?? 'unreachable'}`))
    }
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('dataTransferPage.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">{t('dataTransferPage.subtitle')}</p>
        </header>

        <div className="flex max-w-xl flex-col gap-4">
          {/* SFTP */}
          <div className="rounded-md border p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                className="mt-0.5"
                checked={form.sftpEnabled}
                onCheckedChange={(v) => set({ sftpEnabled: v === true })}
              />
              <span className="flex items-center gap-2">
                <FolderInput className="size-4 text-muted-foreground" />
                <span>
                  <span className="text-[13px] font-[450]">{t('dataTransferPage.sftp')}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('dataTransferPage.sftpDesc')}
                  </span>
                </span>
              </span>
            </label>
            {form.sftpEnabled && (
              <div className="mt-4 flex flex-col gap-2 pl-7">
                <Label className="text-label">{t('dataTransferPage.sftpHost')}</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      value={form.sftpHost}
                      placeholder="sftp.operia.com"
                      className="pr-8 font-mono text-xs"
                      onChange={(e) => {
                        set({ sftpHost: e.target.value })
                        setTestResult(null)
                      }}
                    />
                    {testResult && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2">
                        {testResult === 'ok' ? (
                          <Check className="size-4 text-emerald-500" />
                        ) : (
                          <X className="size-4 text-destructive" />
                        )}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={testing || !form.sftpHost.trim()}
                    onClick={testConnection}
                  >
                    {testing ? t('common.loading') : t('dataTransferPage.test')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('dataTransferPage.sftpHostHint')}</p>
              </div>
            )}
          </div>

          {/* Automatisk e-mail */}
          <div className="rounded-md border p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                className="mt-0.5"
                checked={form.emailEnabled}
                onCheckedChange={(v) => set({ emailEnabled: v === true })}
              />
              <span className="flex items-center gap-2">
                <Mail className="size-4 text-muted-foreground" />
                <span>
                  <span className="text-[13px] font-[450]">{t('dataTransferPage.email')}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('dataTransferPage.emailDesc')}
                  </span>
                </span>
              </span>
            </label>
            {form.emailEnabled && (
              <div className="mt-4 flex flex-col gap-2 pl-7">
                <Label className="text-label">{t('dataTransferPage.emailDomain')}</Label>
                <Input
                  value={form.emailBaseDomain}
                  placeholder="operia.com"
                  className="font-mono text-xs"
                  onChange={(e) => set({ emailBaseDomain: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('dataTransferPage.emailDomainHint')}</p>

                {/* Afsenderforsvar (sikkerhed) */}
                <div className="mt-3 flex flex-col gap-3 border-t border-border/60 pt-4">
                  <SwitchRow
                    checked={form.antispoofEnabled}
                    onChange={(v) => set({ antispoofEnabled: v, antispoofStrict: v && form.antispoofStrict })}
                    label={t('dataTransferPage.antispoof')}
                    hint={t('dataTransferPage.antispoofHint')}
                    recommended
                  />
                  <SwitchRow
                    checked={form.antispoofStrict}
                    onChange={(v) => set({ antispoofStrict: v })}
                    disabled={!form.antispoofEnabled}
                    label={t('dataTransferPage.antispoofStrict')}
                    hint={t('dataTransferPage.antispoofStrictHint')}
                    indent
                  />
                  <SwitchRow
                    checked={form.allowlistRequired}
                    onChange={(v) => set({ allowlistRequired: v })}
                    label={t('dataTransferPage.allowlistRequired')}
                    hint={t('dataTransferPage.allowlistRequiredHint')}
                    recommended
                  />
                </div>
              </div>
            )}
          </div>

          {/* Planlagt import (fast klokkeslæt) */}
          <div className="rounded-md border p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                className="mt-0.5"
                checked={form.scheduleEnabled}
                onCheckedChange={(v) => set({ scheduleEnabled: v === true })}
              />
              <span className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                <span>
                  <span className="text-[13px] font-[450]">{t('dataTransferPage.schedule')}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('dataTransferPage.scheduleDesc')}
                  </span>
                </span>
              </span>
            </label>
            {form.scheduleEnabled && (
              <div className="mt-4 flex flex-col gap-2 pl-7">
                <Label className="text-label">{t('dataTransferPage.scheduleTime')}</Label>
                <TimePicker
                  value={form.scheduleTime}
                  onChange={(v) => set({ scheduleTime: v })}
                  ariaLabel={t('dataTransferPage.scheduleTime')}
                />
                <p className="text-xs text-muted-foreground">{t('dataTransferPage.scheduleHint')}</p>
              </div>
            )}
          </div>
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

import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ExternalLink, Info, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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
import { ACCOUNTING_PROVIDER_KEYS, ACCOUNTING_PROVIDERS } from '@/lib/accounting'
import { INBOUND_PROVIDERS, MAIL_PROVIDERS, inboundProvider, mailProvider } from '@/lib/mail'
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
  { key: 'slack', labelKey: 'integrationsPage.slack' },
  { key: 'email', labelKey: 'integrationsPage.email' },
  { key: 'accounting', labelKey: 'integrationsPage.accounting' },
  { key: 'dalux', labelKey: 'integrationsPage.dalux' },
]

type Form = {
  enabled: boolean
  anonymizeRetired: boolean
  intervalMinutes: number
  aiEnabled: boolean
  aiProviders: string[]
  aiModels: string[]
  // Slack har ingen platform-indstillinger ud over "udbydes den?" — resten af
  // opsætningen er kundens egen OAuth-installation.
  slackEnabled: boolean
  // Regnskab: udbydes den, og hvilke systemer. DCA's egen app-hemmelighed
  // (e-conomic AppSecretToken) er IKKE en del af formularen — den skrives
  // separat via edge-funktionen economic-config og kan aldrig læses igen.
  accountingEnabled: boolean
  daluxEnabled: boolean
  accountingProviders: string[]
  // E-mail: hvilken udbyder de to ender kører på, og hvem mailen kommer fra.
  // Nøglen til Brevo er IKKE en del af formularen — den skrives separat via
  // edge-funktionen mail-config og kan aldrig læses igen.
  emailProvider: string
  emailInboundProvider: string
  emailFrom: string
  ahasendAccountId: string
}

// Svaret fra mail-config 'test'. Nøglen kommer aldrig retur — kun hvilken
// Brevo-konto den hører til, og om afsenderadressen er verificeret dér.
type MailTest = {
  ok: boolean
  reason?: string
  accountEmail?: string | null
  companyName?: string | null
  plan?: string | null
  from?: string
  senderVerified?: boolean | null
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
    slackEnabled: false,
    accountingEnabled: false,
    daluxEnabled: false,
    accountingProviders: [],
    emailProvider: 'resend',
    emailInboundProvider: 'postmark',
    emailFrom: '',
    ahasendAccountId: '',
  })
  const [saving, setSaving] = useState(false)
  const [appSecret, setAppSecret] = useState('')
  const [secretBusy, setSecretBusy] = useState(false)
  const [brevoKey, setBrevoKey] = useState('')
  const [mailBusy, setMailBusy] = useState(false)
  const [mailTest, setMailTest] = useState<MailTest | null>(null)

  const initial: Form | null = data
    ? {
        enabled: data.entra_enabled,
        anonymizeRetired: data.entra_anonymize_retired,
        intervalMinutes: data.entra_sync_interval_minutes,
        aiEnabled: data.ai_enabled,
        aiProviders: data.ai_providers ?? [],
        aiModels: data.ai_models ?? [],
        slackEnabled: data.slack_enabled,
        accountingEnabled: data.accounting_enabled,
        daluxEnabled: data.dalux_enabled,
        accountingProviders: data.accounting_providers ?? [],
        emailProvider: data.email_provider,
        emailInboundProvider: data.email_inbound_provider,
        emailFrom: data.email_from ?? '',
        ahasendAccountId: data.ahasend_account_id ?? '',
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
        slack_enabled: form.slackEnabled,
        accounting_enabled: form.accountingEnabled,
        dalux_enabled: form.daluxEnabled,
        accounting_providers: form.accountingProviders,
        email_provider: form.emailProvider,
        email_inbound_provider: form.emailInboundProvider,
        // Tom = arv edge-secret'en; gem null frem for tom streng.
        email_from: form.emailFrom.trim() || null,
        ahasend_account_id: form.ahasendAccountId.trim() || null,
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

  // e-conomic AppSecretToken: skrives via economic-config (kun platform-admin)
  // og spejles som economic_app_secret_set — feltet er derfor altid tomt.
  const appSecretSet = !!data?.economic_app_secret_set
  const economic = ACCOUNTING_PROVIDERS.find((p) => p.key === 'economic')!

  const saveAppSecret = async () => {
    const value = appSecret.trim()
    if (!value) return
    setSecretBusy(true)
    const { data: res, error } = await supabase.functions.invoke('economic-config', {
      body: { action: 'save_app_secret', secret: value },
    })
    setSecretBusy(false)
    if (error || !res?.ok) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    setAppSecret('')
    toast.success(t('integrationsPage.economicAppSecretSaved'))
    queryClient.invalidateQueries({ queryKey: ['platform-settings'] })
  }

  const clearAppSecret = async () => {
    setSecretBusy(true)
    const { data: res, error } = await supabase.functions.invoke('economic-config', {
      body: { action: 'clear_app_secret' },
    })
    setSecretBusy(false)
    if (error || !res?.ok) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('integrationsPage.economicAppSecretCleared'))
    queryClient.invalidateQueries({ queryKey: ['platform-settings'] })
  }

  // Brevos API-nøgle: skrives via mail-config (kun platform-admin) og spejles
  // som brevo_api_key_set — feltet er derfor altid tomt.
  const outbound = mailProvider(form.emailProvider)
  // Hver udbyder har sit eget "nøgle sat"-spejl.
  const keySet = form.emailProvider === 'ahasend'
    ? !!data?.ahasend_api_key_set
    : !!data?.brevo_api_key_set
  const inbound = inboundProvider(form.emailInboundProvider)

  const callMailConfig = async (body: Record<string, unknown>): Promise<MailTest | null> => {
    setMailBusy(true)
    const { data: res, error } = await supabase.functions.invoke('mail-config', { body })
    setMailBusy(false)
    if (error) {
      toast.error(describeError(error, t))
      return null
    }
    return res as MailTest
  }

  // Testen skal ALTID efterlade et synligt svar under knappen. En toast alene
  // dur ikke: den vises øverst til højre, langt fra knappen, og forsvinder af
  // sig selv — trykker man og kigger på knappen, ser det ud som om intet skete.
  const testBrevoConnection = async () => {
    setMailTest(null)
    const { data: res, error } = await supabase.functions.invoke('mail-config', {
      body: { action: 'test' },
    })
    if (error) {
      toast.error(describeError(error, t))
      setMailTest({ ok: false, reason: 'request_failed' })
      return
    }
    setMailTest((res as MailTest) ?? { ok: false, reason: 'request_failed' })
  }

  const saveBrevoKey = async () => {
    const value = brevoKey.trim()
    if (!value) return
    const res = await callMailConfig({
      action: 'save_api_key',
      secret: value,
      provider: form.emailProvider,
    })
    if (!res?.ok) {
      if (res) toast.error(t('common.noPermission'))
      return
    }
    setBrevoKey('')
    setMailTest(null)
    toast.success(t('integrationsPage.brevoApiKeySaved'))
    queryClient.invalidateQueries({ queryKey: ['platform-settings'] })
  }

  const clearBrevoKey = async () => {
    const res = await callMailConfig({ action: 'clear_api_key', provider: form.emailProvider })
    if (!res?.ok) {
      if (res) toast.error(t('common.noPermission'))
      return
    }
    setMailTest(null)
    toast.success(t('integrationsPage.brevoApiKeyCleared'))
    queryClient.invalidateQueries({ queryKey: ['platform-settings'] })
  }

  // Testen læser udbyder og afsender fra det GEMTE — derfor advares der i
  // UI'et, hvis formularen har ugemte ændringer.
  const testBrevo = async () => {
    setMailBusy(true)
    await testBrevoConnection()
    setMailBusy(false)
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

          {selected === 'slack' && (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={form.slackEnabled}
                    onCheckedChange={(v) => set({ slackEnabled: v === true })}
                  />
                  <span>
                    <span className="text-[13px] font-[450]">
                      {t('integrationsPage.slackEnable')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t('integrationsPage.slackEnableDesc')}
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {selected === 'dalux' && (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={form.daluxEnabled}
                    onCheckedChange={(v) => set({ daluxEnabled: v === true })}
                  />
                  <span>
                    <span className="text-[13px] font-[450]">
                      {t('integrationsPage.daluxEnable')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t('integrationsPage.daluxEnableDesc')}
                    </span>
                  </span>
                </label>
              </div>
              <p className="max-w-2xl text-xs text-muted-foreground">
                {t('integrationsPage.daluxExplainer')}
              </p>
            </div>
          )}

          {selected === 'email' && (
            <div className="flex flex-col gap-6">
              {/* ── Udgående ────────────────────────────────────────────── */}
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-[13px] font-[450]">{t('integrationsPage.emailOutbound')}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('integrationsPage.emailOutboundDesc')}
                  </p>
                </div>

                <div className="rounded-md border p-4">
                  <Label className="text-label">{t('integrationsPage.emailProvider')}</Label>
                  <Select
                    value={form.emailProvider}
                    onValueChange={(v) => {
                      set({ emailProvider: v })
                      setMailTest(null)
                    }}
                  >
                    <SelectTrigger className="mt-2 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MAIL_PROVIDERS.map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {outbound && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t('integrationsPage.emailVendor', {
                        vendor: outbound.vendor,
                        country: t(`integrationsPage.country_${outbound.country}`),
                      })}
                    </p>
                  )}
                </div>

                <div className="rounded-md border p-4">
                  <Label className="text-label" htmlFor="email-from">
                    {t('integrationsPage.emailFrom')}
                  </Label>
                  <Input
                    id="email-from"
                    value={form.emailFrom}
                    placeholder="Operia <noreply@predictioninstitute.com>"
                    className="mt-2 font-mono text-xs"
                    onChange={(e) => set({ emailFrom: e.target.value })}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('integrationsPage.emailFromHint')}
                  </p>
                </div>

                {outbound?.keyInUi && (
                  <div className="flex flex-col gap-3 rounded-md border p-4">
                    <span className="flex items-center gap-2 text-[13px] font-[450]">
                      <KeyRound className="size-4 text-muted-foreground" />
                      {t('integrationsPage.providerCredentials', { provider: outbound.label })}
                    </span>

                    {/* AhaSend adresserer kontoen i selve URL'en. Det er ikke en
                        hemmelighed, så det står i indstillingerne og gemmes med
                        resten af formularen. */}
                    {outbound.needsAccountId && (
                      <div className="flex flex-col gap-2">
                        <Label className="text-label" htmlFor="ahasend-account">
                          {t('integrationsPage.ahasendAccountId')}
                        </Label>
                        <Input
                          id="ahasend-account"
                          value={form.ahasendAccountId}
                          placeholder="00000000-0000-0000-0000-000000000000"
                          className="font-mono text-xs"
                          onChange={(e) => set({ ahasendAccountId: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('integrationsPage.ahasendAccountIdHint')}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-col gap-2">
                      <Label className="text-label">{t('integrationsPage.providerApiKey')}</Label>
                      <div className="flex gap-2">
                        <Input
                          value={brevoKey}
                          type="password"
                          autoComplete="new-password"
                          placeholder={
                            keySet
                              ? t('integrationsPage.brevoApiKeySet')
                              : t('integrationsPage.brevoApiKeyMissing')
                          }
                          className="flex-1 font-mono text-xs"
                          onChange={(e) => setBrevoKey(e.target.value)}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={mailBusy || !brevoKey.trim()}
                          onClick={saveBrevoKey}
                        >
                          {t('common.save')}
                        </Button>
                        {keySet && (
                          <Button variant="ghost" size="sm" disabled={mailBusy} onClick={clearBrevoKey}>
                            {t('integrationsPage.brevoApiKeyClear')}
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('integrationsPage.brevoApiKeyHint')}{' '}
                        {form.emailProvider === 'brevo' && (
                          <>{t('integrationsPage.brevoInboundKeyNote')} </>
                        )}
                        {outbound.keyUrl && (
                          <a
                            href={outbound.keyUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline underline-offset-2"
                          >
                            {t('integrationsPage.providerKeyLink', { provider: outbound.label })}
                            <ExternalLink className="size-3" />
                          </a>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <Button variant="outline" size="sm" disabled={mailBusy || !keySet} onClick={testBrevo}>
                        {mailBusy ? t('common.loading') : t('integrationsPage.emailTest')}
                      </Button>
                      {/* Knappen er slået fra uden en gemt nøgle — sig hvorfor,
                          i stedet for bare at ignorere klikket. */}
                      {!keySet && (
                        <span className="text-xs text-muted-foreground">
                          {t('integrationsPage.emailTestNeedsKey')}
                        </span>
                      )}
                      {dirty && (
                        <span className="text-xs text-amber-600 dark:text-amber-500">
                          {t('integrationsPage.emailTestDirty')}
                        </span>
                      )}
                    </div>

                    {mailTest && (
                      <div className="flex flex-col gap-1.5 rounded-md bg-muted/60 p-3 text-xs">
                        {mailTest.ok ? (
                          <>
                            <span className="flex items-center gap-2 text-foreground-light">
                              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
                              {t('integrationsPage.emailTestOk', {
                                provider: outbound.label,
                                account: mailTest.companyName || mailTest.accountEmail || '—',
                              })}
                            </span>
                            {/* Udbyderen afviser mail fra en afsender den ikke
                                kender — den fejl skal ses her og ikke først på
                                den første rigtige mail. */}
                            {mailTest.senderVerified === true && (
                              <span className="flex items-center gap-2 text-foreground-light">
                                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-500" />
                                {t('integrationsPage.emailSenderVerified', { provider: outbound.label, from: mailTest.from ?? '' })}
                              </span>
                            )}
                            {mailTest.senderVerified === false && (
                              <span className="flex items-center gap-2 text-foreground-light">
                                <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                                {t('integrationsPage.emailSenderUnverified', { provider: outbound.label, from: mailTest.from ?? '' })}
                              </span>
                            )}
                            {mailTest.senderVerified === null && (
                              <span className="text-muted-foreground">
                                {t('integrationsPage.emailSenderUnknown', { provider: outbound.label })}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="flex items-center gap-2 text-foreground-light">
                            <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                            {t('integrationsPage.emailTestFailed', {
                              reason: t(`integrationsPage.emailTestReason_${mailTest.reason ?? 'rejected'}`, {
                                provider: outbound.label,
                                defaultValue: mailTest.reason ?? '',
                              }),
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Klik-sporing er ikke kosmetik for konto-mails: et
                    nulstillingslink er engangs, så en mailscanner der følger et
                    wrappet link kan bruge tokenet op. */}
                {outbound?.linkTracking === 'forced' && (
                  <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground-light">
                    <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                    <span>{t('integrationsPage.emailLinkTrackingWarning', { provider: outbound.label })}</span>
                  </p>
                )}

                {outbound?.outsideEu === false && (
                  <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
                    <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                    <span>
                      {t('integrationsPage.emailEuExplainer', {
                        provider: outbound.label,
                        vendor: outbound.vendor,
                      })}
                    </span>
                  </p>
                )}
              </div>

              {/* ── Indgående ───────────────────────────────────────────── */}
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-[13px] font-[450]">{t('integrationsPage.emailInbound')}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('integrationsPage.emailInboundDesc')}
                  </p>
                </div>

                <div className="rounded-md border p-4">
                  <Label className="text-label">{t('integrationsPage.emailInboundProvider')}</Label>
                  <Select
                    value={form.emailInboundProvider}
                    onValueChange={(v) => set({ emailInboundProvider: v })}
                  >
                    <SelectTrigger className="mt-2 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INBOUND_PROVIDERS.map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {inbound && (
                    <>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t('integrationsPage.emailVendor', {
                          vendor: inbound.vendor,
                          country: t(`integrationsPage.country_${inbound.country}`),
                        })}
                      </p>
                      <p className="mt-3 text-label">{t('integrationsPage.emailMx')}</p>
                      <ul className="mt-1 flex flex-col gap-1 font-mono text-xs text-foreground-light">
                        {inbound.mx.map((r) => (
                          <li key={r.host}>
                            {data?.email_base_domain || '—'} MX {r.priority} {r.host}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {t('integrationsPage.emailMxHint')}
                      </p>
                    </>
                  )}
                </div>

                <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
                  <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                  <span>{t('integrationsPage.emailInboundExplainer')}</span>
                </p>
              </div>
            </div>
          )}

          {selected === 'accounting' && (
            <div className="flex flex-col gap-4">
              <div className="rounded-md border p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={form.accountingEnabled}
                    onCheckedChange={(v) => set({ accountingEnabled: v === true })}
                  />
                  <span>
                    <span className="text-[13px] font-[450]">
                      {t('integrationsPage.accountingEnable')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t('integrationsPage.accountingEnableDesc')}
                    </span>
                  </span>
                </label>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-label">{t('integrationsPage.accountingProviders')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('integrationsPage.accountingProvidersDesc')}
                </p>
                <div className="flex flex-col gap-2 rounded-md border p-4">
                  {ACCOUNTING_PROVIDERS.map((p) => (
                    <label key={p.key} className="flex cursor-pointer items-center gap-3">
                      <Checkbox
                        checked={form.accountingProviders.includes(p.key)}
                        onCheckedChange={() =>
                          set({
                            accountingProviders: toggleKey(
                              form.accountingProviders,
                              p.key,
                              ACCOUNTING_PROVIDER_KEYS,
                            ),
                          })
                        }
                      />
                      <span className="text-[13px]">{p.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {form.accountingProviders.includes('economic') && (
                <div className="flex flex-col gap-3 rounded-md border p-4">
                  <span className="flex items-center gap-2 text-[13px] font-[450]">
                    <KeyRound className="size-4 text-muted-foreground" />
                    {t('integrationsPage.economicCredentials')}
                  </span>
                  <div className="flex flex-col gap-2">
                    <Label className="text-label">{t('integrationsPage.economicAppSecret')}</Label>
                    <div className="flex gap-2">
                      <Input
                        value={appSecret}
                        type="password"
                        autoComplete="new-password"
                        placeholder={
                          appSecretSet
                            ? t('integrationsPage.economicAppSecretSet')
                            : t('integrationsPage.economicAppSecretMissing')
                        }
                        className="flex-1 font-mono text-xs"
                        onChange={(e) => setAppSecret(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={secretBusy || !appSecret.trim()}
                        onClick={saveAppSecret}
                      >
                        {t('common.save')}
                      </Button>
                      {appSecretSet && (
                        <Button variant="ghost" size="sm" disabled={secretBusy} onClick={clearAppSecret}>
                          {t('integrationsPage.economicAppSecretClear')}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t('integrationsPage.economicAppSecretHint')}{' '}
                      <a
                        href={economic.developerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 underline underline-offset-2"
                      >
                        {t('integrationsPage.economicDeveloperLink')}
                        <ExternalLink className="size-3" />
                      </a>
                    </p>
                  </div>
                  <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
                    <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                    <span>{t('integrationsPage.economicExplainer')}</span>
                  </p>
                </div>
              )}
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

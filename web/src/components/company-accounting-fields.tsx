import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Check, ExternalLink, KeyRound, X } from 'lucide-react'
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
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { ACCOUNTING_PROVIDERS, accountingProvider } from '@/lib/accounting'
import { supabase } from '@/lib/supabase'

// Pr. virksomhed: kundens forbindelse til sit regnskabssystem (e-conomic i dag).
//
// Adgangstokenet (e-conomic: AgreementGrantToken) skrives via edge-funktionen
// economic-config og kan aldrig læses tilbage — feltet er derfor altid tomt, og
// "sat ✓" kommer fra det spejlede flag token_set. "Test forbindelse" kører
// server-side, hvor både DCA's app-hemmelighed og kundens token findes, og
// skriver aftalenummer + firmanavn tilbage som verifikation.

type Form = { enabled: boolean; provider: string }

export function CompanyAccountingFields({ companyId }: { companyId: string }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { data: platform } = usePlatformSettings()
  const [form, setForm] = useState<Form>({ enabled: false, provider: 'economic' })
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null)

  const offeredKeys = (platform?.accounting_providers ?? []) as string[]
  const offered = ACCOUNTING_PROVIDERS.filter((p) => offeredKeys.includes(p.key))

  const { data, isPending } = useQuery({
    queryKey: ['company-accounting', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_accounting_config')
        .select('enabled, provider, token_set, agreement_number, agreement_company_name, verified_at')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const initial: Form = {
    enabled: data?.enabled ?? false,
    provider: data?.provider ?? offered[0]?.key ?? 'economic',
  }

  // Nulstil kun når de GEMTE værdier faktisk ændrer sig — ikke ved enhver
  // genhentning. Token-gem og "Test forbindelse" genhenter rækken (token_set,
  // verified_at), og det må ikke smide et endnu ikke gemt flueben i "slå til".
  const initialKey = JSON.stringify(initial)
  useEffect(() => {
    setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }))
    if ('provider' in patch) setTestResult(null)
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const tokenSet = !!data?.token_set
  const provider = accountingProvider(form.provider)
  const appSecretSet = !!platform?.economic_app_secret_set

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['company-accounting', companyId] })

  const save = async () => {
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('company_accounting_config')
      .upsert(
        { company_id: companyId, enabled: form.enabled, provider: form.provider },
        { onConflict: 'company_id' },
      )
      .select('company_id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const saveSecret = async () => {
    const value = secret.trim()
    if (!value) return
    setSaving(true)
    const { data: res, error } = await supabase.functions.invoke('economic-config', {
      body: { companyId, action: 'save_token', secret: value },
    })
    setSaving(false)
    if (error || !res?.ok) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    setSecret('')
    setTestResult(null)
    toast.success(t('companyAccounting.tokenSaved'))
    refresh()
  }

  const clearSecret = async () => {
    setSaving(true)
    const { data: res, error } = await supabase.functions.invoke('economic-config', {
      body: { companyId, action: 'clear_token' },
    })
    setSaving(false)
    if (error || !res?.ok) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    setTestResult(null)
    toast.success(t('companyAccounting.tokenCleared'))
    refresh()
  }

  const testConnection = async () => {
    setTesting(true)
    const { data: res, error } = await supabase.functions.invoke('economic-config', {
      body: { companyId, action: 'test' },
    })
    setTesting(false)
    if (error) {
      setTestResult('fail')
      toast.error(describeError(error, t))
      return
    }
    if (res?.ok) {
      setTestResult('ok')
      toast.success(
        t('companyAccounting.testOk', {
          agreement: res.agreementNumber,
          company: res.companyName ?? '',
        }),
      )
      refresh()
    } else {
      setTestResult('fail')
      toast.error(t(`companyAccounting.test_${res?.reason ?? 'network'}`))
    }
  }

  if (!platform?.accounting_enabled || offered.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('companyAccounting.notOffered')}</p>
  }
  if (isPending) return <Skeleton className="h-40 w-full" />

  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex max-w-xl flex-col gap-4">
        <div className="rounded-md border p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={form.enabled}
              onCheckedChange={(v) => set({ enabled: v === true })}
            />
            <span>
              <span className="text-[13px] font-[450]">{t('companyAccounting.enable')}</span>
              <span className="block text-xs text-muted-foreground">
                {t('companyAccounting.enableDesc')}
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('companyAccounting.provider')}</Label>
            <Select value={form.provider} onValueChange={(v) => set({ provider: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {offered.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {provider && (
          <div className="flex flex-col gap-3 rounded-md border p-4">
            <span className="flex items-center gap-2 text-[13px] font-[450]">
              <KeyRound className="size-4 text-muted-foreground" />
              {t('companyAccounting.credentials')}
            </span>

            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('companyAccounting.grantToken')}</Label>
              <div className="flex gap-2">
                <Input
                  value={secret}
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    tokenSet ? t('companyAccounting.tokenSet') : t('companyAccounting.tokenMissing')
                  }
                  className="flex-1 font-mono text-xs"
                  onChange={(e) => setSecret(e.target.value)}
                />
                <Button variant="outline" size="sm" disabled={saving || !secret.trim()} onClick={saveSecret}>
                  {t('companyAccounting.saveToken')}
                </Button>
                {tokenSet && (
                  <Button variant="ghost" size="sm" disabled={saving} onClick={clearSecret}>
                    {t('companyAccounting.clearToken')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('companyAccounting.grantTokenHint')}{' '}
                <a
                  href={provider.tokenHelpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-2"
                >
                  {t('companyAccounting.grantTokenHelp')}
                  <ExternalLink className="size-3" />
                </a>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={testing || !tokenSet || !appSecretSet}
                onClick={testConnection}
              >
                {testing ? t('common.loading') : t('companyAccounting.test')}
              </Button>
              {testResult === 'ok' && <Check className="size-4 text-emerald-500" />}
              {testResult === 'fail' && <X className="size-4 text-destructive" />}
              {!tokenSet && (
                <span className="text-xs text-muted-foreground">{t('companyAccounting.incomplete')}</span>
              )}
              {tokenSet && !appSecretSet && (
                <span className="text-xs text-muted-foreground">
                  {t('companyAccounting.appSecretMissing')}
                </span>
              )}
            </div>

            {data?.verified_at && (
              <p className="text-xs text-muted-foreground">
                {t('companyAccounting.verified', {
                  agreement: data.agreement_number ?? '',
                  company: data.agreement_company_name ?? '',
                  date: dateFmt.format(new Date(data.verified_at)),
                })}
              </p>
            )}
          </div>
        )}
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => setForm(initial)} disabled={saving}>
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

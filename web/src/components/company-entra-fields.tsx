import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Check, Info, KeyRound, TriangleAlert, X } from 'lucide-react'
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
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { supabase } from '@/lib/supabase'

// Pr. virksomhed: kundens egen Entra-opsætning. Bruges både på Konfigurér →
// Integrationer (kunden selv) og fra kundedetaljen på Operia → Kunder.
//
// Client secret'en skrives via edge-funktionen entra-config og kan aldrig læses
// tilbage — feltet er derfor altid tomt, og "sat ✓" kommer fra det spejlede
// flag client_secret_set. Test og tørkørsel kører også server-side, hvor
// hemmeligheden findes.

// Arv fra platformen vises som et selvstændigt valg i stedet for en tom værdi,
// så det er tydeligt at kunden ikke har taget stilling.
const INHERIT = 'inherit'

type Form = {
  enabled: boolean
  tenantId: string
  clientId: string
  groupId: string
  groupName: string
  initialsSource: string
  anonymizeRetired: string // 'inherit' | 'on' | 'off'
  interval: string // 'inherit' | minutter
}

const EMPTY: Form = {
  enabled: false,
  tenantId: '',
  clientId: '',
  groupId: '',
  groupName: '',
  initialsSource: '',
  anonymizeRetired: INHERIT,
  interval: INHERIT,
}

type DryRun = {
  created: number
  updated: number
  deactivated: number
  departments: number
  unchanged: number
  users: number
}

export function CompanyEntraFields({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: platform } = usePlatformSettings()
  const [form, setForm] = useState<Form>(EMPTY)
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null)
  const [dryRunning, setDryRunning] = useState(false)
  const [dryRun, setDryRun] = useState<DryRun | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['company-entra', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_entra_config')
        .select(
          'enabled, tenant_id, client_id, client_secret_set, group_id, group_name, initials_source, anonymize_retired, sync_interval_minutes, dry_run_at, first_sync_at, last_sync_at, last_sync_status, last_sync_error',
        )
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  // Er CSV-ingest slået til? De to kilder udelukker hinanden i databasen, så
  // det skal siges her frem for at komme som en uforklarlig gemme-fejl.
  const { data: transfer } = useQuery({
    queryKey: ['company-data-transfer-flags', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_data_transfer')
        .select('sftp_enabled, email_enabled')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
  const csvActive = !!(transfer?.sftp_enabled || transfer?.email_enabled)

  const initial: Form | null = data
    ? {
        enabled: data.enabled,
        tenantId: data.tenant_id ?? '',
        clientId: data.client_id ?? '',
        groupId: data.group_id ?? '',
        groupName: data.group_name ?? '',
        initialsSource: data.initials_source ?? '',
        anonymizeRetired:
          data.anonymize_retired === null ? INHERIT : data.anonymize_retired ? 'on' : 'off',
        interval: data.sync_interval_minutes === null ? INHERIT : String(data.sync_interval_minutes),
      }
    : EMPTY

  useEffect(() => {
    setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }))
    // Ændret opsætning ⇒ gammel test/tørkørsel siger ikke længere noget.
    if ('tenantId' in patch || 'clientId' in patch || 'groupId' in patch) {
      setTestResult(null)
      setDryRun(null)
    }
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const secretSet = !!data?.client_secret_set
  const complete = !!form.tenantId.trim() && !!form.clientId.trim() && secretSet
  // Kun dry_run_at tæller: værnet nulstiller den når tenant/klient/gruppe
  // ændres, og en ny opsætning må ikke arve en gammel godkendelse — at der
  // engang HAR været synkroniseret (first_sync_at) er ikke en godkendelse.
  const dryRunDone = !!data?.dry_run_at

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['company-entra', companyId] })
  }

  const save = async () => {
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('company_entra_config')
      .upsert(
        {
          company_id: companyId,
          enabled: form.enabled,
          tenant_id: form.tenantId.trim() || null,
          client_id: form.clientId.trim() || null,
          group_id: form.groupId.trim() || null,
          group_name: form.groupName.trim() || null,
          initials_source: form.initialsSource.trim() || null,
          anonymize_retired: form.anonymizeRetired === INHERIT ? null : form.anonymizeRetired === 'on',
          sync_interval_minutes: form.interval === INHERIT ? null : Number(form.interval),
        },
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
    const { data: res, error } = await supabase.functions.invoke('entra-config', {
      body: { companyId, action: 'save_secret', clientSecret: value },
    })
    setSaving(false)
    if (error || !res?.ok) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    setSecret('')
    setTestResult(null)
    setDryRun(null)
    toast.success(t('companyEntra.secretSaved'))
    refresh()
  }

  const testConnection = async () => {
    setTesting(true)
    const { data: res, error } = await supabase.functions.invoke('entra-config', {
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
      toast.success(t('companyEntra.testOk', { count: res.userCount ?? 0 }))
    } else {
      setTestResult('fail')
      toast.error(t(`companyEntra.test_${res?.reason ?? 'auth_failed'}`))
    }
  }

  const runDryRun = async () => {
    setDryRunning(true)
    const { data: res, error } = await supabase.functions.invoke('entra-sync', {
      body: { companyId, mode: 'dry_run' },
    })
    setDryRunning(false)
    if (error || !res?.ok) {
      toast.error(error ? describeError(error, t) : t(`companyEntra.test_${res?.reason ?? 'auth_failed'}`))
      return
    }
    setDryRun({
      created: res.counts.created,
      updated: res.counts.updated,
      deactivated: res.counts.deactivated,
      departments: res.counts.departments,
      unchanged: res.counts.unchanged,
      users: res.userCount ?? 0,
    })
    refresh()
  }

  const syncNow = async () => {
    setDryRunning(true)
    const { data: res, error } = await supabase.functions.invoke('entra-sync', {
      body: { companyId, mode: 'apply' },
    })
    setDryRunning(false)
    if (error || !res?.ok) {
      toast.error(error ? describeError(error, t) : t(`companyEntra.test_${res?.reason ?? 'auth_failed'}`))
      refresh()
      return
    }
    toast.success(
      t('companyEntra.syncOk', {
        created: res.counts.created,
        updated: res.counts.updated,
        deactivated: res.counts.deactivated,
      }),
    )
    setDryRun(null)
    refresh()
  }

  if (!platform?.entra_enabled) {
    return <p className="text-sm text-muted-foreground">{t('companyEntra.notOffered')}</p>
  }
  if (isPending) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex max-w-xl flex-col gap-4">
        {csvActive && (
          <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-foreground-light">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-500" />
            <span>{t('companyEntra.csvConflict')}</span>
          </p>
        )}

        <div className="rounded-md border p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={form.enabled}
              disabled={csvActive}
              onCheckedChange={(v) => set({ enabled: v === true })}
            />
            <span>
              <span className="text-[13px] font-[450]">{t('companyEntra.enable')}</span>
              <span className="block text-xs text-muted-foreground">
                {t('companyEntra.enableDesc')}
              </span>
            </span>
          </label>
        </div>

        {/* Credentials */}
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <span className="flex items-center gap-2 text-[13px] font-[450]">
            <KeyRound className="size-4 text-muted-foreground" />
            {t('companyEntra.credentials')}
          </span>

          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('companyEntra.tenantId')}</Label>
            <Input
              value={form.tenantId}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="font-mono text-xs"
              onChange={(e) => set({ tenantId: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('companyEntra.clientId')}</Label>
            <Input
              value={form.clientId}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="font-mono text-xs"
              onChange={(e) => set({ clientId: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('companyEntra.clientSecret')}</Label>
            <div className="flex gap-2">
              <Input
                value={secret}
                type="password"
                autoComplete="new-password"
                placeholder={secretSet ? t('companyEntra.secretSet') : t('companyEntra.secretMissing')}
                className="flex-1 font-mono text-xs"
                onChange={(e) => setSecret(e.target.value)}
              />
              <Button variant="outline" size="sm" disabled={saving || !secret.trim()} onClick={saveSecret}>
                {t('companyEntra.saveSecret')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('companyEntra.clientSecretHint')}</p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={testing || !complete} onClick={testConnection}>
              {testing ? t('common.loading') : t('companyEntra.test')}
            </Button>
            {testResult === 'ok' && <Check className="size-4 text-emerald-500" />}
            {testResult === 'fail' && <X className="size-4 text-destructive" />}
            {!complete && (
              <span className="text-xs text-muted-foreground">{t('companyEntra.incomplete')}</span>
            )}
          </div>
        </div>

        {/* Afgrænsning og felter */}
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('companyEntra.group')}</Label>
            <Input
              value={form.groupId}
              placeholder={t('companyEntra.groupPlaceholder')}
              className="font-mono text-xs"
              onChange={(e) => set({ groupId: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('companyEntra.groupHint')}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('companyEntra.initialsSource')}</Label>
            <Input
              value={form.initialsSource}
              placeholder="mailNickname"
              className="font-mono text-xs"
              onChange={(e) => set({ initialsSource: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('companyEntra.initialsSourceHint')}</p>
          </div>
        </div>

        {/* Politik — arves fra Operia med mindre kunden vælger andet */}
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('companyEntra.anonymizeRetired')}</Label>
            <Select
              value={form.anonymizeRetired}
              onValueChange={(v) => set({ anonymizeRetired: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>
                  {t('companyEntra.inherit', {
                    value: platform.entra_anonymize_retired
                      ? t('integrationsPage.on')
                      : t('integrationsPage.off'),
                  })}
                </SelectItem>
                <SelectItem value="on">{t('integrationsPage.on')}</SelectItem>
                <SelectItem value="off">{t('integrationsPage.off')}</SelectItem>
              </SelectContent>
            </Select>
            {(form.anonymizeRetired === 'on' ||
              (form.anonymizeRetired === INHERIT && platform.entra_anonymize_retired)) && (
              <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
                <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                <span>{t('integrationsPage.anonymizeExplainer')}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('integrationsPage.syncInterval')}</Label>
            <Select value={form.interval} onValueChange={(v) => set({ interval: v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>
                  {t('companyEntra.inherit', {
                    value: t(`integrationsPage.interval_${platform.entra_sync_interval_minutes}`),
                  })}
                </SelectItem>
                {SYNC_INTERVALS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t(`integrationsPage.interval_${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tørkørsel + status */}
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <span className="text-[13px] font-[450]">{t('companyEntra.run')}</span>
          <p className="text-xs text-muted-foreground">
            {dryRunDone ? t('companyEntra.dryRunDone') : t('companyEntra.dryRunRequired')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={dryRunning || !complete} onClick={runDryRun}>
              {dryRunning ? t('common.loading') : t('companyEntra.dryRun')}
            </Button>
            <Button
              size="sm"
              disabled={dryRunning || !complete || !dryRunDone || !form.enabled || dirty}
              onClick={syncNow}
            >
              {t('companyEntra.syncNow')}
            </Button>
          </div>

          {dryRun && (
            <div className="rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
              <p className="font-[450]">{t('companyEntra.dryRunResult', { count: dryRun.users })}</p>
              <ul className="mt-1 space-y-0.5">
                <li>{t('companyEntra.willCreate', { count: dryRun.created })}</li>
                <li>{t('companyEntra.willUpdate', { count: dryRun.updated })}</li>
                <li>{t('companyEntra.willDeactivate', { count: dryRun.deactivated })}</li>
                <li>{t('companyEntra.willCreateDepartments', { count: dryRun.departments })}</li>
                <li>{t('companyEntra.willLeave', { count: dryRun.unchanged })}</li>
              </ul>
            </div>
          )}

          {data?.last_sync_at && (
            <p className="text-xs text-muted-foreground">
              {t('companyEntra.lastSync', {
                when: new Date(data.last_sync_at).toLocaleString(),
                status: t(`companyEntra.status_${data.last_sync_status ?? 'ok'}`),
              })}
              {data.last_sync_error ? ` — ${t(`companyEntra.test_${data.last_sync_error}`)}` : ''}
            </p>
          )}
        </div>
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

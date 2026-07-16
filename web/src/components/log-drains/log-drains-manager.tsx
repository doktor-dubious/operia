import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { KeyRound, Plus, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import {
  Dialog,
  DialogContent,
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
import { useCompanyContext } from '@/hooks/use-company-context'
import { generateStrongPassword } from '@/lib/password'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Log-drains-administration — delt af kunde-skærmen (/configure/log-drains) og
// platform-skærmen (/operia/log-drains). scope='company' arbejder på den valgte
// virksomheds dræn; scope='platform' på platform-niveau-dræn (company_id null).
// Hemmeligheden er skrive-kun (kan ikke læses tilbage); et testkald verificerer
// en destination uden at røre vandmærket.

type Destination = 'http' | 'datadog' | 'loki'

type Drain = {
  id: string
  company_id: string | null
  name: string
  destination: Destination
  endpoint: string | null
  config: Record<string, unknown> | null
  enabled: boolean
  secret_set: boolean
  last_run_at: string | null
  last_status: 'ok' | 'error' | null
  last_error: string | null
}

const SELECT =
  'id, company_id, name, destination, endpoint, config, enabled, secret_set, last_run_at, last_status, last_error'

const DATADOG_SITES = [
  'datadoghq.eu',
  'datadoghq.com',
  'us3.datadoghq.com',
  'us5.datadoghq.com',
  'ap1.datadoghq.com',
]

const dateFmt = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

type FormState = {
  id: string | null
  name: string
  destination: Destination
  enabled: boolean
  endpoint: string
  secret: string
  secretSet: boolean
  site: string
  service: string
  ddtags: string
  username: string
}

function blankForm(): FormState {
  return {
    id: null,
    name: '',
    destination: 'http',
    enabled: true,
    endpoint: '',
    secret: '',
    secretSet: false,
    site: 'datadoghq.eu',
    service: 'operia',
    ddtags: '',
    username: '',
  }
}

function formFromDrain(d: Drain): FormState {
  const cfg = (d.config ?? {}) as Record<string, string>
  return {
    id: d.id,
    name: d.name,
    destination: d.destination,
    enabled: d.enabled,
    endpoint: d.endpoint ?? '',
    secret: '',
    secretSet: d.secret_set,
    site: cfg.site ?? 'datadoghq.eu',
    service: cfg.service ?? 'operia',
    ddtags: cfg.ddtags ?? '',
    username: cfg.username ?? '',
  }
}

// companyId: valgfri override af den aktive virksomhed — bruges når en platform-
// admin konfigurerer et specifikt kundes dræn (operia/customers). Ellers tages
// den aktive virksomhed fra konteksten (scope='company') eller null (platform).
export function LogDrainsManager({
  scope,
  companyId: companyIdProp,
}: {
  scope: 'company' | 'platform'
  companyId?: string
}) {
  const { t } = useTranslation()
  const { companyId: ctxCompanyId } = useCompanyContext()
  const companyId = companyIdProp ?? ctxCompanyId
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Drain | null>(null)
  const [showSecret, setShowSecret] = useState(false)

  const openForm = (f: FormState) => {
    setForm(f)
    setShowSecret(false)
  }

  const enabledForCompany = scope === 'platform' || !!companyId
  const queryKey = ['log-drains', scope, companyId]

  const { data, isPending } = useQuery({
    queryKey,
    enabled: enabledForCompany,
    queryFn: async () => {
      // Aktive dræn øverst, derefter ældste først.
      let q = supabase
        .from('log_drains')
        .select(SELECT)
        .order('enabled', { ascending: false })
        .order('created_at', { ascending: true })
      q = scope === 'platform' ? q.is('company_id', null) : q.eq('company_id', companyId!)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as Drain[]
    },
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey })

  const toggleEnabled = async (drain: Drain, enabled: boolean) => {
    const { error } = await supabase.from('log_drains').update({ enabled }).eq('id', drain.id)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    refresh()
  }

  const sendTest = async (drain: Drain) => {
    setTesting(drain.id)
    try {
      const { data, error } = await supabase.functions.invoke('log-drain-dispatch', {
        body: { mode: 'test', drainId: drain.id },
      })
      if (error) throw error
      const res = data as { ok?: boolean; status?: number; detail?: string | null }
      if (res?.ok) toast.success(t('logDrains.testOk', { status: res.status }))
      else toast.error(t('logDrains.testError', { detail: res?.detail ?? res?.status ?? '' }))
    } catch (e) {
      toast.error(t('logDrains.testError', { detail: (e as Error).message }))
    } finally {
      setTesting(null)
      refresh()
    }
  }

  const save = async () => {
    if (!form) return
    if (!form.name.trim()) {
      toast.error(t('logDrains.nameRequired'))
      return
    }
    const needsEndpoint = form.destination === 'http' || form.destination === 'loki'
    if (needsEndpoint && !form.endpoint.trim()) {
      toast.error(t('logDrains.endpointRequired'))
      return
    }
    if (form.destination === 'datadog' && !form.secretSet && !form.secret.trim()) {
      toast.error(t('logDrains.apiKeyRequired'))
      return
    }
    if (form.destination === 'loki' && !form.username.trim()) {
      toast.error(t('logDrains.usernameRequired'))
      return
    }

    // Destinationsspecifik config
    let config: Record<string, string> = {}
    if (form.destination === 'datadog') {
      config = { site: form.site }
      if (form.service.trim()) config.service = form.service.trim()
      if (form.ddtags.trim()) config.ddtags = form.ddtags.trim()
    } else if (form.destination === 'loki') {
      if (form.username.trim()) config = { username: form.username.trim() }
    }

    const row: Record<string, unknown> = {
      name: form.name.trim(),
      destination: form.destination,
      enabled: form.enabled,
      endpoint: needsEndpoint ? form.endpoint.trim() : null,
      config,
    }
    // secret er skrive-kun: send kun hvis brugeren har indtastet noget (ellers
    // bevares den eksisterende ved redigering).
    if (form.secret.trim()) row.secret = form.secret.trim()

    setSaving(true)
    let error
    if (form.id) {
      ;({ error } = await supabase.from('log_drains').update(row as never).eq('id', form.id))
    } else {
      row.company_id = scope === 'platform' ? null : companyId
      ;({ error } = await supabase.from('log_drains').insert(row as never))
    }
    setSaving(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('settings.saved'))
    setForm(null)
    refresh()
  }

  // Slet et (inaktivt) dræn. Kaster ved fejl, så bekræftelses-dialogen viser den.
  const remove = async (drain: Drain) => {
    const { error } = await supabase.from('log_drains').delete().eq('id', drain.id)
    if (error) throw error
    toast.success(t('logDrains.deleted'))
    refresh()
  }

  if (!enabledForCompany) return <p className="text-sm text-muted-foreground">{t('common.noPermission')}</p>
  if (isPending) return <Skeleton className="h-40 w-full" />

  const drains = data ?? []
  const destLabel = (d: Destination) =>
    t(d === 'http' ? 'logDrains.destHttp' : d === 'datadog' ? 'logDrains.destDatadog' : 'logDrains.destLoki')

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-foreground">{t('logDrains.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-foreground-light">
            {t(scope === 'platform' ? 'logDrains.subtitlePlatform' : 'logDrains.subtitleCompany')}
          </p>
        </div>
        <Button size="sm" onClick={() => openForm(blankForm())}>
          <Plus className="size-4" />
          {t('logDrains.newDrain')}
        </Button>
      </header>

      {drains.length === 0 ? (
        <Card className="bg-panel">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('logDrains.empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {drains.map((drain) => (
            <Card key={drain.id} className="bg-panel">
              <CardContent className="flex items-center gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button
                      className="truncate text-[13px] font-medium hover:underline"
                      onClick={() => openForm(formFromDrain(drain))}
                    >
                      {drain.name}
                    </button>
                    <Badge variant="secondary" className="shrink-0">
                      {destLabel(drain.destination)}
                    </Badge>
                    {!drain.secret_set && (
                      <span className="text-xs text-status-neutral-to-bad">
                        {t('logDrains.noSecret')}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {drain.endpoint ?? (drain.config as Record<string, string>)?.site ?? '—'}
                  </p>
                  <p className="mt-1 text-xs">
                    {drain.last_status ? (
                      <span
                        className={cn(
                          drain.last_status === 'ok'
                            ? 'text-status-good-to-neutral'
                            : 'text-destructive',
                        )}
                      >
                        {t(drain.last_status === 'ok' ? 'logDrains.statusOk' : 'logDrains.statusError')}
                        {drain.last_run_at && ` · ${dateFmt.format(new Date(drain.last_run_at))}`}
                        {drain.last_status === 'error' && drain.last_error && ` · ${drain.last_error}`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t('logDrains.statusNever')}</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={testing === drain.id}
                    onClick={() => sendTest(drain)}
                  >
                    <Send className="size-3.5" />
                    {testing === drain.id ? t('logDrains.testing') : t('logDrains.test')}
                  </Button>
                  <Switch
                    checked={drain.enabled}
                    onCheckedChange={(v) => toggleEnabled(drain, v)}
                    aria-label={t('logDrains.enabled')}
                  />
                  {/* Slet kun muligt på inaktive dræn (undgå at slette noget der
                      stadig videresender). */}
                  {!drain.enabled && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                      onClick={() => setDeleteTarget(drain)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Opret/redigér-dialog */}
      <Dialog
        open={!!form}
        onOpenChange={(open) => {
          if (!open) {
            setForm(null)
            setShowSecret(false)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? t('logDrains.editDrain') : t('logDrains.newDrain')}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>{t('logDrains.name')}</Label>
                <Input
                  value={form.name}
                  placeholder={t('logDrains.namePlaceholder')}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>{t('logDrains.destination')}</Label>
                  <Select
                    value={form.destination}
                    onValueChange={(v) => setForm({ ...form, destination: v as Destination })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">{t('logDrains.destHttp')}</SelectItem>
                      <SelectItem value="datadog">{t('logDrains.destDatadog')}</SelectItem>
                      <SelectItem value="loki">{t('logDrains.destLoki')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-between gap-3 pb-1">
                  <Label>{t('logDrains.enabled')}</Label>
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                  />
                </div>
              </div>

              {/* Endpoint (HTTP + Loki) */}
              {(form.destination === 'http' || form.destination === 'loki') && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t('logDrains.endpoint')}</Label>
                  <Input
                    value={form.endpoint}
                    placeholder={form.destination === 'loki' ? 'https://logs.example.com' : 'https://example.com/ingest'}
                    onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t(form.destination === 'loki' ? 'logDrains.endpointLokiHint' : 'logDrains.endpointHttpHint')}
                  </p>
                </div>
              )}

              {/* Datadog-felter */}
              {form.destination === 'datadog' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('logDrains.ddSite')}</Label>
                    <Select value={form.site} onValueChange={(v) => setForm({ ...form, site: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DATADOG_SITES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('logDrains.ddService')}</Label>
                    <Input
                      value={form.service}
                      onChange={(e) => setForm({ ...form, service: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 flex flex-col gap-1.5">
                    <Label>{t('logDrains.ddTags')}</Label>
                    <Input
                      value={form.ddtags}
                      placeholder="env:prod,team:security"
                      onChange={(e) => setForm({ ...form, ddtags: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {/* Loki-brugernavn (basic auth) — påkrævet: Grafana Cloud bruger
                  Loki-instans-/bruger-ID'et som basic-auth-brugernavn. */}
              {form.destination === 'loki' && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t('logDrains.lokiUsername')}</Label>
                  <Input
                    value={form.username}
                    placeholder="1680464"
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{t('logDrains.lokiUsernameHint')}</p>
                </div>
              )}

              {/* Hemmelighed (skrive-kun) */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label>
                    {t(form.destination === 'datadog' ? 'logDrains.apiKey' : 'logDrains.secret')}
                  </Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={() => setShowSecret((s) => !s)}
                  >
                    {showSecret ? t('common.hide') : t('common.show')}
                  </Button>
                </div>
                <Input
                  type={showSecret ? 'text' : 'password'}
                  value={form.secret}
                  placeholder={form.secretSet ? t('logDrains.secretKeep') : t('logDrains.secretNew')}
                  onChange={(e) => setForm({ ...form, secret: e.target.value })}
                />
                {/* Generér-knap kun for generisk HTTP: her er token en delt
                    hemmelighed du selv vælger (Datadog/Loki bruger leverandørens nøgle). */}
                {form.destination === 'http' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 w-fit gap-1.5 text-xs"
                    onClick={() => {
                      setForm((f) => (f ? { ...f, secret: generateStrongPassword(32) } : f))
                      setShowSecret(true)
                    }}
                  >
                    <KeyRound className="size-3.5" />
                    {t('logDrains.generateToken')}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  {form.destination === 'http'
                    ? t('logDrains.tokenHint')
                    : form.secretSet
                      ? t('logDrains.secretSetHint')
                      : t('logDrains.secretHint')}
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setForm(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bekræftet sletning (kun inaktive dræn) */}
      {deleteTarget && (
        <ConfirmDeleteDialog
          open={!!deleteTarget}
          onOpenChange={(o) => {
            if (!o) setDeleteTarget(null)
          }}
          title={t('logDrains.deleteTitle', { name: deleteTarget.name })}
          description={t('logDrains.deleteWarning')}
          acknowledgeText={t('logDrains.deleteAck')}
          confirmLabel={t('logDrains.deleteConfirmLabel')}
          onConfirm={() => remove(deleteTarget)}
        />
      )}
    </div>
  )
}

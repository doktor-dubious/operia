import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, KeyRound, Play, RotateCcw, X } from 'lucide-react'
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
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Konfigurér → Integrationer → Dalux FM (EVU-krav B-05..B-10).
//
// Opsætningen er i tre lag, og rækkefølgen på skærmen er rækkefølgen i
// virkeligheden: nøglen (fra kundens Dalux-admin, helst på stage-miljøet),
// forbindelsestesten (som også afslører hvilke brugerdefinerede felter rummene
// har — et Dalux-rum har intet navnefelt), og først derefter hvad der skal
// udveksles og hvornår.
//
// De udgående retninger (bookinger, fakturaer) kan ikke slås til, før kunden
// har valgt hvilket Dalux-objekt en booking bliver til (B-08). Det er ikke en
// mangel i skærmen — det er spørgsmålet, der ikke er besvaret endnu, gjort
// synligt der hvor svaret skal indtastes.

type Config = {
  enabled: boolean
  environment: string
  api_key_set: boolean
  api_key_expires_at: string | null
  sync_rooms_in: boolean
  sync_assets_in: boolean
  sync_bookings_out: boolean
  sync_invoices_out: boolean
  booking_target: string | null
  room_name_field: string | null
  schedule_mode: string
  interval_minutes: number | null
  run_time: string | null
  run_weekday: number | null
  run_monthday: number | null
  verified_at: string | null
  verified_detail: { buildings?: number; sample?: string | null; room_fields?: string[]; room_error?: string | null } | null
  last_run_at: string | null
  last_run_status: string | null
  last_run_error: string | null
}

type Form = Pick<
  Config,
  | 'enabled'
  | 'environment'
  | 'sync_rooms_in'
  | 'sync_assets_in'
  | 'sync_bookings_out'
  | 'sync_invoices_out'
  | 'booking_target'
  | 'room_name_field'
  | 'schedule_mode'
  | 'interval_minutes'
  | 'run_time'
  | 'run_weekday'
  | 'run_monthday'
>

const NONE = '__none__'
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] // mandag først
const INTERVALS = [15, 60, 240, 720]

export function CompanyDaluxFields({ companyId }: { companyId: string }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Form | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<
    { ok: true; buildings: number; sample: string | null } | { ok: false; reason: string } | null
  >(null)

  const cfgKey = ['company-dalux', companyId]
  const { data, isPending } = useQuery({
    queryKey: cfgKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_dalux_config')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as Config | null
    },
  })

  const { data: failed } = useQuery({
    queryKey: ['company-dalux-failed', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dalux_sync_items')
        .select('id, object_type, direction, external_id, status, last_error, attempts, last_attempt_at')
        .eq('company_id', companyId)
        .in('status', ['failed', 'skipped'])
        .order('updated_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    },
  })

  const initial: Form = {
    enabled: data?.enabled ?? false,
    environment: data?.environment ?? 'stage',
    sync_rooms_in: data?.sync_rooms_in ?? true,
    sync_assets_in: data?.sync_assets_in ?? false,
    sync_bookings_out: data?.sync_bookings_out ?? false,
    sync_invoices_out: data?.sync_invoices_out ?? false,
    booking_target: data?.booking_target ?? null,
    room_name_field: data?.room_name_field ?? null,
    schedule_mode: data?.schedule_mode ?? 'manual',
    interval_minutes: data?.interval_minutes ?? null,
    run_time: data?.run_time ? data.run_time.slice(0, 5) : null,
    run_weekday: data?.run_weekday ?? null,
    run_monthday: data?.run_monthday ?? null,
  }
  const initialKey = JSON.stringify(initial)
  useEffect(() => {
    setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: cfgKey })
    void queryClient.invalidateQueries({ queryKey: ['company-dalux-failed', companyId] })
  }

  if (isPending || !form) return <Skeleton className="h-40 w-full" />

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const dirty = JSON.stringify(form) !== initialKey
  const keySet = !!data?.api_key_set
  const verified = !!data?.verified_at
  const roomFields = data?.verified_detail?.room_fields ?? []
  const roomError = data?.verified_detail?.room_error ?? null
  const fmtDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(i18n.language.startsWith('en') ? 'en-GB' : 'da-DK', {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'Europe/Copenhagen',
        }).format(new Date(iso))
      : '—'
  const keyExpiringSoon =
    !!data?.api_key_expires_at &&
    new Date(data.api_key_expires_at).getTime() - Date.now() < 14 * 86_400_000

  const invoke = async (body: Record<string, unknown>) => {
    const { data: res, error } = await supabase.functions.invoke('dalux-sync', {
      body: { companyId, ...body },
    })
    if (error) throw error
    return res as Record<string, unknown>
  }

  const save = async () => {
    // Udgående retninger uden aftalt objekt: basen afviser det også, men
    // skærmen skal sige hvorfor, ikke bare "fejl".
    if (form.sync_bookings_out && !form.booking_target) {
      toast.error(t('companyDalux.errBookingTarget'))
      return
    }
    setBusy(true)
    const { data: saved, error } = await supabase
      .from('company_dalux_config')
      .upsert(
        {
          company_id: companyId,
          ...form,
          run_time: form.run_time || null,
        },
        { onConflict: 'company_id' },
      )
      .select('company_id')
    setBusy(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const saveKey = async () => {
    if (!apiKey.trim()) return
    setBusy(true)
    try {
      await invoke({ action: 'save_key', apiKey: apiKey.trim(), expiresAt: expires || undefined })
      setApiKey('')
      setExpires('')
      setTestResult(null)
      toast.success(t('companyDalux.keySaved'))
      refresh()
    } catch (e) {
      toast.error(describeError(e as { message?: string }, t))
    } finally {
      setBusy(false)
    }
  }

  const clearKey = async () => {
    setBusy(true)
    try {
      await invoke({ action: 'clear_key' })
      setTestResult(null)
      toast.success(t('companyDalux.keyCleared'))
      refresh()
    } catch (e) {
      toast.error(describeError(e as { message?: string }, t))
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    try {
      const res = await invoke({ action: 'test' })
      if (res.ok) {
        setTestResult({
          ok: true,
          buildings: Number(res.buildings ?? 0),
          sample: (res.sample as string | null) ?? null,
        })
      } else {
        setTestResult({ ok: false, reason: String(res.reason ?? 'internal') })
      }
      refresh()
    } catch (e) {
      toast.error(describeError(e as { message?: string }, t))
    } finally {
      setBusy(false)
    }
  }

  const runNow = async () => {
    setBusy(true)
    try {
      const res = await invoke({ action: 'run', trigger: 'manual' })
      const counts = (res.counts as Record<string, Record<string, number>> | undefined)?.rooms
      if (res.ok) {
        toast.success(
          t('companyDalux.runDone', {
            created: counts?.created ?? 0,
            updated: (counts?.updated ?? 0) + (counts?.adopted ?? 0),
            failed: (counts?.failed ?? 0) + (counts?.skipped ?? 0),
          }),
        )
      } else {
        toast.error(t(`companyDalux.reason.${String(res.reason)}`, String(res.reason)))
      }
      refresh()
    } catch (e) {
      toast.error(describeError(e as { message?: string }, t))
    } finally {
      setBusy(false)
    }
  }

  const retry = async (id: string) => {
    const { error } = await supabase.rpc('dalux_retry_item', { p_item_id: id })
    if (error) toast.error(describeError(error, t))
    else {
      toast.success(t('companyDalux.retried'))
      refresh()
    }
  }

  const Row = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={cn('rounded-md border p-4', className)}>{children}</div>
  )

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <p className="text-xs text-muted-foreground">{t('companyDalux.intro')}</p>

      {/* ── 1. Nøgle og miljø ──────────────────────────────────────────── */}
      <Row>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('companyDalux.environment')}</Label>
            <Select value={form.environment} onValueChange={(v) => set({ environment: v })}>
              <SelectTrigger className="w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stage">{t('companyDalux.envStage')}</SelectItem>
                <SelectItem value="production">{t('companyDalux.envProduction')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('companyDalux.environmentHint')}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('companyDalux.apiKey')}</Label>
            <div className="flex items-center gap-2 text-[13px]">
              {keySet ? (
                <Check className="size-4 text-status-good" />
              ) : (
                <X className="size-4 text-muted-foreground" />
              )}
              <span>{keySet ? t('companyDalux.keySet') : t('companyDalux.keyNotSet')}</span>
              {keySet && data?.api_key_expires_at && (
                <span
                  className={cn(
                    'text-xs',
                    keyExpiringSoon ? 'text-status-neutral-to-bad' : 'text-muted-foreground',
                  )}
                >
                  · {t('companyDalux.keyExpires', { date: data.api_key_expires_at })}
                </span>
              )}
              {keySet && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clearKey()}>
                  {t('companyDalux.clearKey')}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                type="password"
                autoComplete="off"
                className="w-72 font-mono text-xs"
                placeholder={t('companyDalux.keyPlaceholder')}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">{t('companyDalux.expiresAt')}</Label>
                <Input
                  type="date"
                  className="w-40"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              </div>
              <Button size="sm" disabled={busy || !apiKey.trim()} onClick={() => void saveKey()}>
                <KeyRound className="size-4" />
                {keySet ? t('companyDalux.replaceKey') : t('companyDalux.saveKey')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('companyDalux.apiKeyHint')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" disabled={busy || !keySet || dirty} onClick={() => void test()}>
              {t('companyDalux.test')}
            </Button>
            {dirty && <span className="text-xs text-muted-foreground">{t('companyDalux.saveFirst')}</span>}
            {testResult?.ok && (
              <span className="text-xs text-status-good">
                {t('companyDalux.testOk', {
                  count: testResult.buildings,
                  sample: testResult.sample ?? '—',
                })}
              </span>
            )}
            {testResult && !testResult.ok && (
              <span className="text-xs text-destructive">
                {t(`companyDalux.reason.${testResult.reason}`, testResult.reason)}
              </span>
            )}
            {!testResult && verified && (
              <span className="text-xs text-muted-foreground">
                {t('companyDalux.verifiedAt', { date: fmtDate(data!.verified_at) })}
              </span>
            )}
          </div>
        </div>
      </Row>

      {/* ── 2. Hvad udveksles (B-08) ───────────────────────────────────── */}
      <Row>
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-[450]">{t('companyDalux.objects')}</span>
          <label className="flex items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={form.sync_rooms_in}
              onCheckedChange={(v) => set({ sync_rooms_in: v === true })}
            />
            <span>
              <span className="text-[13px]">{t('companyDalux.roomsIn')}</span>
              <span className="block text-xs text-muted-foreground">{t('companyDalux.roomsInDesc')}</span>
            </span>
          </label>
          {form.sync_rooms_in && (
            <div className="ml-7 flex flex-col gap-2">
              <Label className="text-label">{t('companyDalux.roomNameField')}</Label>
              <Select
                value={form.room_name_field ?? NONE}
                onValueChange={(v) => set({ room_name_field: v === NONE ? null : v })}
              >
                <SelectTrigger className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('companyDalux.roomNameFieldNone')}</SelectItem>
                  {[...new Set([...(form.room_name_field ? [form.room_name_field] : []), ...roomFields])].map(
                    (f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {roomError
                  ? t('companyDalux.roomFieldsFailed', { reason: t(`companyDalux.test_${roomError}`, roomError) })
                  : roomFields.length === 0
                    ? t('companyDalux.roomNameFieldTestFirst')
                    : t('companyDalux.roomNameFieldHint')}
              </p>
            </div>
          )}

          <label className="flex items-start gap-3 opacity-60">
            <Checkbox className="mt-0.5" checked={form.sync_assets_in} disabled />
            <span>
              <span className="text-[13px]">{t('companyDalux.assetsIn')}</span>
              <span className="block text-xs text-muted-foreground">{t('companyDalux.notYet')}</span>
            </span>
          </label>

          <div className="flex flex-col gap-2 border-t pt-3">
            <Label className="text-label">{t('companyDalux.bookingTarget')}</Label>
            <Select
              value={form.booking_target ?? NONE}
              onValueChange={(v) =>
                set({
                  booking_target: v === NONE ? null : v,
                  sync_bookings_out: v === NONE ? false : form.sync_bookings_out,
                })
              }
            >
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('companyDalux.bookingTargetNone')}</SelectItem>
                <SelectItem value="workorder">{t('companyDalux.targetWorkorder')}</SelectItem>
                <SelectItem value="ticket">{t('companyDalux.targetTicket')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('companyDalux.bookingTargetHint')}</p>
          </div>
          <label className={cn('flex items-start gap-3', !form.booking_target && 'opacity-60')}>
            <Checkbox
              className="mt-0.5"
              checked={form.sync_bookings_out}
              disabled={!form.booking_target}
              onCheckedChange={(v) => set({ sync_bookings_out: v === true })}
            />
            <span>
              <span className="text-[13px]">{t('companyDalux.bookingsOut')}</span>
              <span className="block text-xs text-muted-foreground">
                {form.booking_target ? t('companyDalux.notYet') : t('companyDalux.needsTarget')}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 opacity-60">
            <Checkbox className="mt-0.5" checked={form.sync_invoices_out} disabled />
            <span>
              <span className="text-[13px]">{t('companyDalux.invoicesOut')}</span>
              <span className="block text-xs text-muted-foreground">{t('companyDalux.notYet')}</span>
            </span>
          </label>
        </div>
      </Row>

      {/* ── 3. Tidsplan (B-07) ─────────────────────────────────────────── */}
      <Row>
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-[450]">{t('companyDalux.schedule')}</span>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-label">{t('companyDalux.scheduleMode')}</Label>
              <Select value={form.schedule_mode} onValueChange={(v) => set({ schedule_mode: v })}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['manual', 'interval', 'daily', 'weekly', 'monthly'].map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`companyDalux.mode.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.schedule_mode === 'interval' && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-label">{t('companyDalux.every')}</Label>
                <Select
                  value={String(form.interval_minutes ?? 60)}
                  onValueChange={(v) => set({ interval_minutes: Number(v) })}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVALS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {t(`companyDalux.interval_${m}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.schedule_mode === 'weekly' && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-label">{t('companyDalux.weekday')}</Label>
                <Select
                  value={String(form.run_weekday ?? 1)}
                  onValueChange={(v) => set({ run_weekday: Number(v) })}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {t(`companyDalux.weekday_${d}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.schedule_mode === 'monthly' && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-label">{t('companyDalux.monthday')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={28}
                  className="w-24"
                  value={form.run_monthday ?? 1}
                  onChange={(e) => set({ run_monthday: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })}
                />
              </div>
            )}
            {['daily', 'weekly', 'monthly'].includes(form.schedule_mode) && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-label">{t('companyDalux.time')}</Label>
                <Input
                  type="time"
                  className="w-32"
                  value={form.run_time ?? '02:00'}
                  onChange={(e) => set({ run_time: e.target.value })}
                />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('companyDalux.scheduleHint')}</p>
        </div>
      </Row>

      {/* ── 4. Slå til, gem, kør ───────────────────────────────────────── */}
      <Row>
        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={form.enabled}
              onCheckedChange={(v) => set({ enabled: v === true })}
            />
            <span>
              <span className="text-[13px] font-[450]">{t('companyDalux.enable')}</span>
              <span className="block text-xs text-muted-foreground">{t('companyDalux.enableDesc')}</span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? t('common.loading') : t('common.saveChanges')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || dirty || !data?.enabled || !verified}
              onClick={() => void runNow()}
            >
              <Play className="size-4" />
              {t('companyDalux.runNow')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('companyDalux.lastRun', {
                date: fmtDate(data?.last_run_at ?? null),
                status: data?.last_run_status
                  ? t(`companyDalux.status.${data.last_run_status}`)
                  : '—',
              })}
            </span>
          </div>
        </div>
      </Row>

      {/* ── 5. Fejlliste (B-09) ────────────────────────────────────────── */}
      {(failed ?? []).length > 0 && (
        <Row>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-[450]">{t('companyDalux.failedTitle')}</span>
            <p className="text-xs text-muted-foreground">{t('companyDalux.failedHint')}</p>
            <div className="flex flex-col divide-y rounded-md border">
              {(failed ?? []).map((f) => (
                <div key={f.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className="w-16 text-muted-foreground">
                    {t(`companyDalux.object.${f.object_type}`, f.object_type)}
                  </span>
                  <span className="w-40 truncate font-mono">{f.external_id ?? '—'}</span>
                  <span className="flex-1 text-destructive">
                    {t(`companyDalux.itemError.${f.last_error ?? 'internal'}`, f.last_error ?? '')}
                  </span>
                  <span className="text-muted-foreground">×{f.attempts}</span>
                  {/* Sprunget over (fx rum uden navn) retter sig selv ved næste
                      kørsel, når feltet er udfyldt i Dalux — der er intet at gensende. */}
                  {f.status === 'failed' ? (
                    <Button size="sm" variant="ghost" onClick={() => void retry(f.id)}>
                      <RotateCcw className="size-3.5" />
                      {t('companyDalux.retry')}
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">{t('companyDalux.skipped')}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Row>
      )}
    </div>
  )
}

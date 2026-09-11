import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Planlagt fileksport af bookinger (EVU-krav B-02) — Konfigurér → Booking.
//
// Opsætningen gemmes række for række som en indstilling; "Kør nu" kører den
// samme funktion som cron, så det, man ser nu, er det, der kommer om natten.
// Filerne står nedenfor med download — også for den, der ikke fik mailen.

type Row = {
  enabled: boolean
  frequency: string
  run_time: string
  run_weekday: number | null
  run_monthday: number | null
  period: string
  shape: string
  profile: string
  recipient_email: string | null
  last_run_at: string | null
  last_run_status: string | null
  last_run_error: string | null
}

type Form = Omit<Row, 'last_run_at' | 'last_run_status' | 'last_run_error'>

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]

export function BookingExportScheduleFields({ companyId }: { companyId: string }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, isPending } = useQuery({
    queryKey: ['booking-export-schedule', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_booking_export_schedule')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as Row | null
    },
  })
  const { data: files } = useQuery({
    queryKey: ['booking-export-files', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_export_files')
        .select('id, created_at, trigger, period_from, period_to, shape, profile, rows, storage_path, bytes, delivered_to, status, error')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data ?? []
    },
  })

  const initial: Form = {
    enabled: data?.enabled ?? false,
    frequency: data?.frequency ?? 'weekly',
    run_time: (data?.run_time ?? '06:00').slice(0, 5),
    run_weekday: data?.run_weekday ?? 1,
    run_monthday: data?.run_monthday ?? 1,
    period: data?.period ?? 'previous_week',
    shape: data?.shape ?? 'bookings',
    profile: data?.profile ?? 'excel_da',
    recipient_email: data?.recipient_email ?? '',
  }
  const initialKey = JSON.stringify(initial)
  useEffect(() => {
    setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['booking-export-schedule', companyId] })
    void queryClient.invalidateQueries({ queryKey: ['booking-export-files', companyId] })
  }

  if (isPending || !form) return <Skeleton className="h-24 w-full" />
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const dirty = JSON.stringify(form) !== initialKey
  const fmt = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(i18n.language.startsWith('en') ? 'en-GB' : 'da-DK', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Copenhagen' }).format(new Date(iso)) : '—'

  const save = async () => {
    if (form.enabled && !form.recipient_email?.trim()) {
      toast.error(t('bookingExportSchedule.errRecipient'))
      return
    }
    setBusy(true)
    const { data: saved, error } = await supabase
      .from('company_booking_export_schedule')
      .upsert({ company_id: companyId, ...form, recipient_email: form.recipient_email?.trim() || null }, { onConflict: 'company_id' })
      .select('company_id')
    setBusy(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const runNow = async () => {
    setBusy(true)
    const { data: res, error } = await supabase.functions.invoke('booking-export-run', { body: { companyId, trigger: 'manual' } })
    setBusy(false)
    if (error || !res?.ok) {
      toast.error(error ? describeError(error, t) : String(res?.error ?? t('common.noPermission')))
    } else {
      toast.success(t('bookingExportSchedule.runDone', { rows: res.rows }))
    }
    refresh()
  }

  const download = async (path: string) => {
    const { data, error } = await supabase.storage.from('exports').createSignedUrl(path, 60)
    if (error || !data?.signedUrl) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-[450]">{t('bookingExportSchedule.title')}</span>
        <p className="text-xs text-muted-foreground">{t('bookingExportSchedule.intro')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">{t('bookingExportSchedule.frequency')}</Label>
          <Select value={form.frequency} onValueChange={(v) => set({ frequency: v })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['daily', 'weekly', 'monthly'].map((f) => <SelectItem key={f} value={f}>{t(`bookingExportSchedule.freq.${f}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {form.frequency === 'weekly' && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-label">{t('companyDalux.weekday')}</Label>
            <Select value={String(form.run_weekday ?? 1)} onValueChange={(v) => set({ run_weekday: Number(v) })}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{WEEKDAYS.map((d) => <SelectItem key={d} value={String(d)}>{t(`companyDalux.weekday_${d}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {form.frequency === 'monthly' && (
          <div className="flex flex-col gap-1.5">
            <Label className="text-label">{t('companyDalux.monthday')}</Label>
            <Input type="number" min={1} max={28} className="w-24" value={form.run_monthday ?? 1}
              onChange={(e) => set({ run_monthday: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">{t('companyDalux.time')}</Label>
          <Input type="time" className="w-28" value={form.run_time} onChange={(e) => set({ run_time: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">{t('bookingExportSchedule.period')}</Label>
          <Select value={form.period} onValueChange={(v) => set({ period: v })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['previous_day', 'previous_week', 'previous_month', 'last_30_days'].map((p) => <SelectItem key={p} value={p}>{t(`bookingExportSchedule.per.${p}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">{t('bookingExport.shape')}</Label>
          <Select value={form.shape} onValueChange={(v) => set({ shape: v })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bookings">{t('bookingExport.shapeBookings')}</SelectItem>
              <SelectItem value="lines">{t('bookingExport.shapeLines')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">{t('bookingExport.profile')}</Label>
          <Select value={form.profile} onValueChange={(v) => set({ profile: v })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="excel_da">{t('bookingExport.profile_excel_da')}</SelectItem>
              <SelectItem value="operia">{t('bookingExport.profile_operia')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">{t('bookingExportSchedule.recipient')}</Label>
          <Input type="email" className="w-64" placeholder="fm@firma.dk" value={form.recipient_email ?? ''}
            onChange={(e) => set({ recipient_email: e.target.value })} />
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox className="mt-0.5" checked={form.enabled} onCheckedChange={(v) => set({ enabled: v === true })} />
        <span>
          <span className="text-[13px] font-[450]">{t('bookingExportSchedule.enable')}</span>
          <span className="block text-xs text-muted-foreground">{t('bookingExportSchedule.enableHint')}</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>{busy ? t('common.loading') : t('common.saveChanges')}</Button>
        <Button size="sm" variant="outline" disabled={busy || dirty || !data} onClick={() => void runNow()}>
          <Play className="size-4" /> {t('bookingExportSchedule.runNow')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t('bookingExportSchedule.lastRun', { date: fmt(data?.last_run_at ?? null), status: data?.last_run_status ? t(`companyDalux.status.${data.last_run_status}`) : '—' })}
          {data?.last_run_error ? ` · ${data.last_run_error}` : ''}
        </span>
      </div>

      {(files ?? []).length > 0 && (
        <div className="flex flex-col divide-y rounded-md border">
          {(files ?? []).map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <span className="w-28 text-muted-foreground">{fmt(f.created_at)}</span>
              <span className="w-40 tabular-nums">{f.period_from} – {f.period_to}</span>
              <span className="w-24 text-muted-foreground">{t(`bookingExport.shape${f.shape === 'lines' ? 'Lines' : 'Bookings'}`)}</span>
              <span className={cn('flex-1', f.status === 'failed' && 'text-destructive')}>
                {f.status === 'failed' ? f.error : t('bookingExportSchedule.fileInfo', { rows: f.rows, to: f.delivered_to ?? '—' })}
              </span>
              {f.storage_path && (
                <Button size="sm" variant="ghost" onClick={() => void download(f.storage_path!)}>
                  <Download className="size-3.5" /> {t('bookingExportSchedule.download')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

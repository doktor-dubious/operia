import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { addDays, parseISODate, toISODate } from '@/lib/calendar'
import {
  bookingRpcErrorKey,
  effectiveTimeMode,
  isRetroInterval,
  type BookingHit,
  type BookingTimeMode,
} from '@/lib/booking'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Opret/redigér en booking. Tidsgranulariteten følger ressourcen (egen
// indstilling, ellers virksomhedens): 'timed' = dato + klokkeslæt, 'day' =
// hele dage (fra/til-dato inkl., gemt som midnat-til-midnat med all_day).
// Overlap afgøres af databasens exclusion constraint — fejlen vises pænt.

function toTimeInput(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Sidste HELE dag i et halvåbent all-day-interval (ends_at er næste midnat). */
function lastDayOf(endsAtISO: string): string {
  return toISODate(addDays(new Date(endsAtISO), -1))
}

export function useCompanyBookingConfig(companyId: string | null): {
  mode: BookingTimeMode
  retroAllowed: boolean
} {
  const { data } = useQuery({
    queryKey: ['booking-company-mode', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('booking_time_mode, booking_retro_allowed')
        .eq('id', companyId!)
        .single()
      if (error) throw error
      return data
    },
  })
  return {
    mode: data?.booking_time_mode === 'day' ? 'day' : 'timed',
    retroAllowed: data?.booking_retro_allowed !== false,
  }
}

export function useBookingResources(companyId: string | null) {
  return useQuery({
    queryKey: ['booking-resources-options', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_resources')
        .select('id, name, location, time_mode, is_active')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

export function BookingDialog({
  open,
  onOpenChange,
  companyId,
  booking,
  initialResourceId,
  initialDateISO,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  /** Sat = redigering; ellers oprettelse. */
  booking?: BookingHit | null
  initialResourceId?: string
  initialDateISO?: string
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const { mode: companyMode, retroAllowed } = useCompanyBookingConfig(companyId)
  const { data: resources } = useBookingResources(companyId)

  const [resourceId, setResourceId] = useState('')
  const [employee, setEmployee] = useState<PickedEmployee | null>(null)
  const [dateISO, setDateISO] = useState('')
  const [endDateISO, setEndDateISO] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  // Prefill ved åbning: redigering udfylder fra bookingen; oprettelse fra
  // kalenderens klik (ressource/dato). Medarbejderen genindlæses ikke ved
  // redigering — feltet starter tomt og skal kun udfyldes ved skift.
  const [editEmployeeKept, setEditEmployeeKept] = useState(true)
  useEffect(() => {
    if (!open) return
    if (booking) {
      setResourceId(booking.resource_id)
      setDateISO(toISODate(new Date(booking.starts_at)))
      setEndDateISO(booking.all_day ? lastDayOf(booking.ends_at) : toISODate(new Date(booking.ends_at)))
      setStartTime(toTimeInput(booking.starts_at))
      setEndTime(toTimeInput(booking.ends_at))
      setTitle(booking.title ?? '')
      setEmployee(null)
      setEditEmployeeKept(true)
    } else {
      setResourceId(initialResourceId ?? '')
      setDateISO(initialDateISO ?? toISODate(new Date()))
      setEndDateISO(initialDateISO ?? toISODate(new Date()))
      setStartTime('09:00')
      setEndTime('10:00')
      setTitle('')
      setEmployee(null)
      setEditEmployeeKept(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking?.id])

  const resource = useMemo(
    () => (resources ?? []).find((r) => r.id === resourceId) ?? null,
    [resources, resourceId],
  )
  const mode = effectiveTimeMode(resource, companyMode)

  const selectableResources = useMemo(
    () => (resources ?? []).filter((r) => r.is_active || r.id === booking?.resource_id),
    [resources, booking?.resource_id],
  )

  const employeeId = employee?.id ?? (editEmployeeKept ? booking?.employee_id ?? null : null)

  // 'timed' kan spænde over flere døgn (en bil fredag 14 → mandag 9), så begge
  // ender har dato + klokkeslæt; 'day' er hele dage (slutdato inkl.).
  //
  // Et tomt dato-/klokkeslætsfelt (begge input-typer kan ryddes af brugeren)
  // giver en ugyldig Date. Den må ALDRIG slippe ud af memo'en: nedenfor kaldes
  // der toISOString() på enderne, og på en Invalid Date kaster den RangeError
  // midt i en render. null = "ikke et gyldigt tidsrum endnu", som lukker
  // gemme-knappen på præcis samme måde.
  const interval = useMemo((): { starts: Date; ends: Date } | null => {
    if (!dateISO || !endDateISO) return null
    const [starts, ends] =
      mode === 'day'
        ? [parseISODate(dateISO), addDays(parseISODate(endDateISO), 1)]
        : startTime && endTime
          ? [new Date(`${dateISO}T${startTime}:00`), new Date(`${endDateISO}T${endTime}:00`)]
          : [null, null]
    if (!starts || !ends || isNaN(starts.getTime()) || isNaN(ends.getTime())) return null
    return { starts, ends }
  }, [mode, dateISO, endDateISO, startTime, endTime])

  // Fortids-reglen: blød advarsel når det er tilladt (knappen skifter tekst,
  // så handlingen ikke kan overses), hård blokering når virksomheden har slået
  // det fra (serveren håndhæver uanset). Ved redigering rammes kun ændrede
  // tidsrum — som serveren.
  const intervalChanged =
    !booking ||
    !interval ||
    interval.starts.toISOString() !== new Date(booking.starts_at).toISOString() ||
    interval.ends.toISOString() !== new Date(booking.ends_at).toISOString()
  const retro =
    !!interval &&
    intervalChanged &&
    isRetroInterval(interval.starts, interval.ends, mode === 'day')

  const canSave =
    !!resourceId &&
    !!employeeId &&
    !!interval &&
    interval.ends > interval.starts &&
    !(retro && !retroAllowed) &&
    !busy

  const save = async () => {
    if (!canSave || !interval) return
    setBusy(true)
    const { starts, ends } = interval
    const params = {
      p_resource_id: resourceId,
      p_employee_id: employeeId!,
      p_starts_at: starts.toISOString(),
      p_ends_at: ends.toISOString(),
      p_title: title.trim() || undefined,
      p_all_day: mode === 'day',
    }
    const { error } = booking
      ? await supabase.rpc('update_booking', { p_booking_id: booking.id, ...params })
      : await supabase.rpc('create_booking', params)
    setBusy(false)
    if (error) {
      const key = bookingRpcErrorKey(error)
      toast.error(key ? t(key) : describeError(error, t))
      return
    }
    toast.success(booking ? t('bookingFlow.updatedToast') : t('bookingFlow.createdToast'))
    onSaved()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {booking ? t('bookingFlow.editTitle') : t('bookingFlow.newTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingFlow.resource')}</Label>
          <Select value={resourceId} onValueChange={setResourceId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('bookingFlow.pickResource')} />
            </SelectTrigger>
            <SelectContent>
              {selectableResources.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                  {r.location ? ` · ${r.location}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingFlow.employee')}</Label>
          {booking && editEmployeeKept && !employee ? (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[13px]">
              <span>{booking.employee?.full_name ?? t('bookingFlow.unknownEmployee')}</span>
              <Button size="sm" variant="ghost" onClick={() => setEditEmployeeKept(false)}>
                {t('common.change')}
              </Button>
            </div>
          ) : (
            companyId && <EmployeePicker companyId={companyId} value={employee} onChange={setEmployee} />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('bookingFlow.fromDate')}</Label>
            <Input
              type="date"
              value={dateISO}
              onChange={(e) => {
                setDateISO(e.target.value)
                // Slutdatoen følger med, så et almindeligt møde kun kræver ét datovalg.
                if (e.target.value && (!endDateISO || endDateISO < e.target.value))
                  setEndDateISO(e.target.value)
              }}
            />
          </div>
          {mode === 'timed' && (
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('bookingFlow.fromTime')}</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('bookingFlow.toDate')}</Label>
            <Input type="date" value={endDateISO} onChange={(e) => setEndDateISO(e.target.value)} />
          </div>
          {mode === 'timed' && (
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('bookingFlow.toTime')}</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="booking-title" className="text-label">
            {t('bookingFlow.title')}
          </Label>
          <Input
            id="booking-title"
            value={title}
            maxLength={200}
            placeholder={t('bookingFlow.titlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {retro && retroAllowed && (
          <p className="rounded-md border border-status-neutral-to-bad/50 bg-status-neutral-to-bad/10 px-3 py-2 text-[13px] text-status-neutral-to-bad">
            {t('bookingFlow.retroWarning')}
          </p>
        )}
        {retro && !retroAllowed && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {t('bookingFlow.retroBlocked')}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!canSave} onClick={save}>
            {busy
              ? t('common.loading')
              : retro && retroAllowed
                ? t('bookingFlow.retroConfirm')
                : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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

// Bookingformularen som ÉN kilde, brugt to steder: dialogen (opret fra listen
// og kalenderen, redigér fra kalenderen) og detaljepanelet på bookinglisten,
// hvor de samme felter er fordelt ud på faner.
//
// Uden det her lag ville de to steder have hver sin kopi af tidsrums-regningen,
// fortids-reglen og valideringen — og så er det kun et spørgsmål om tid, før
// den ene tillader noget, den anden afviser.
//
// Al skrivning går gennem create_booking/update_booking; tidsgranulariteten
// følger ressourcen (egen indstilling, ellers virksomhedens): 'timed' = dato +
// klokkeslæt, 'day' = hele dage.

// Radix Select tillader ikke tomme værdier — sentinel for "intet niveau".
export const NO_LEVEL = 'none'

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
        .select('id, name, location, time_mode, is_active, category_id')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

/**
 * Virksomhedens kursistniveauer (EVU A-05). Deaktiverede niveauer hentes med,
 * så en booking der allerede bærer et pensioneret niveau stadig kan vise og
 * beholde det ved redigering — kun NYE valg begrænses til de aktive.
 */
export function useBookingLevels(companyId: string | null) {
  return useQuery({
    queryKey: ['booking-levels', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_participant_levels')
        .select('id, name, is_active, sort_order')
        .eq('company_id', companyId!)
        .order('sort_order')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

export type BookingForm = ReturnType<typeof useBookingForm>

export function useBookingForm({
  companyId,
  booking,
  initialResourceId,
  initialDateISO,
  onSaved,
  onDone,
}: {
  companyId: string | null
  /** Sat = redigering; ellers oprettelse. */
  booking?: BookingHit | null
  initialResourceId?: string
  initialDateISO?: string
  onSaved: () => void
  /** Kaldes efter et gennemført gem — dialogen lukker sig selv med den. */
  onDone?: () => void
}) {
  const { t } = useTranslation()
  const { mode: companyMode, retroAllowed } = useCompanyBookingConfig(companyId)
  const { data: resources } = useBookingResources(companyId)
  const { data: levels } = useBookingLevels(companyId)

  const [resourceId, setResourceId] = useState('')
  const [employee, setEmployee] = useState<PickedEmployee | null>(null)
  const [dateISO, setDateISO] = useState('')
  const [endDateISO, setEndDateISO] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [title, setTitle] = useState('')
  const [participants, setParticipants] = useState('')
  const [levelId, setLevelId] = useState(NO_LEVEL)
  const [busy, setBusy] = useState(false)
  // Medarbejderen genindlæses ikke ved redigering — feltet viser navnet og
  // skal kun udfyldes ved skift.
  const [editEmployeeKept, setEditEmployeeKept] = useState(true)

  const reset = useCallback(() => {
    if (booking) {
      setResourceId(booking.resource_id)
      setDateISO(toISODate(new Date(booking.starts_at)))
      setEndDateISO(
        booking.all_day ? lastDayOf(booking.ends_at) : toISODate(new Date(booking.ends_at)),
      )
      setStartTime(toTimeInput(booking.starts_at))
      setEndTime(toTimeInput(booking.ends_at))
      setTitle(booking.title ?? '')
      setParticipants(booking.participant_count?.toString() ?? '')
      setLevelId(booking.participant_level_id ?? NO_LEVEL)
      setEmployee(null)
      setEditEmployeeKept(true)
    } else {
      setResourceId(initialResourceId ?? '')
      setDateISO(initialDateISO ?? toISODate(new Date()))
      setEndDateISO(initialDateISO ?? toISODate(new Date()))
      setStartTime('09:00')
      setEndTime('10:00')
      setTitle('')
      setParticipants('')
      setLevelId(NO_LEVEL)
      setEmployee(null)
      setEditEmployeeKept(false)
    }
    // Afhænger af selve bookingobjektet, ikke kun id'et: efter et gem + genhent
    // kommer samme booking tilbage som et nyt objekt med de gemte værdier, og
    // 'Fortryd' skal så tilbage til DEM — ikke til øjebliksbilledet fra før
    // gemmet (som næste 'Gem' ellers stille ville skrive tilbage).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking, initialResourceId, initialDateISO])

  useEffect(() => {
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking?.id])

  const resource = useMemo(
    () => (resources ?? []).find((r) => r.id === resourceId) ?? null,
    [resources, resourceId],
  )
  const mode = effectiveTimeMode(resource, companyMode)

  const selectableResources = useMemo(
    () => (resources ?? []).filter((r) => r.is_active || r.id === booking?.resource_id),
    [resources, booking?.resource_id],
  )

  // Kun aktive niveauer kan VÆLGES; bookingens eget niveau bliver stående, selv
  // om kunden har pensioneret det — ellers ville en rettelse af klokkeslættet
  // tvinge en ændring af fakturagrundlaget.
  const selectableLevels = useMemo(
    () => (levels ?? []).filter((l) => l.is_active || l.id === booking?.participant_level_id),
    [levels, booking?.participant_level_id],
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

  // Tomt felt = ikke oplyst (null), ikke 0. Et ugyldigt tal lukker gem-knappen
  // frem for at blive rundet i det stille — serveren afviser det alligevel.
  const participantCount = participants.trim() === '' ? undefined : Number(participants)
  const participantsValid =
    participantCount === undefined ||
    (Number.isInteger(participantCount) && participantCount >= 1 && participantCount <= 100000)

  const canSave =
    participantsValid &&
    !!resourceId &&
    !!employeeId &&
    !!interval &&
    interval.ends > interval.starts &&
    !(retro && !retroAllowed) &&
    !busy

  /**
   * Har brugeren ændret noget? Bruges af panelets gem-bjælke; dialogen har sin
   * egen knap og spørger ikke.
   *
   * Sammenligningen sker på FELTERNES værdier, ikke på de tidsstempler de
   * bygges om til. Et gemt starts_at bærer sekunder, mens dato- og
   * klokkeslætsfelterne kun har minutter — bygger man tiden om og sammenligner
   * ISO-strenge, er en urørt booking "ændret" fra det øjeblik panelet åbner,
   * og gem-bjælken står der hele tiden.
   */
  const formKey = JSON.stringify([
    resourceId,
    employeeId ?? null,
    dateISO,
    endDateISO,
    mode === 'day' ? null : startTime,
    mode === 'day' ? null : endTime,
    title.trim(),
    participants.trim(),
    levelId,
  ])
  const savedKey = booking
    ? JSON.stringify([
        booking.resource_id,
        booking.employee_id,
        toISODate(new Date(booking.starts_at)),
        booking.all_day ? lastDayOf(booking.ends_at) : toISODate(new Date(booking.ends_at)),
        mode === 'day' ? null : toTimeInput(booking.starts_at),
        mode === 'day' ? null : toTimeInput(booking.ends_at),
        booking.title ?? '',
        booking.participant_count?.toString() ?? '',
        booking.participant_level_id ?? NO_LEVEL,
      ])
    : formKey
  const dirty = !!booking && formKey !== savedKey

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
      p_participant_count: participantCount,
      p_participant_level_id: levelId === NO_LEVEL ? undefined : levelId,
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
    onDone?.()
  }

  return {
    companyId,
    booking: booking ?? null,
    resourceId,
    setResourceId,
    employee,
    setEmployee,
    editEmployeeKept,
    setEditEmployeeKept,
    dateISO,
    setDateISO,
    endDateISO,
    setEndDateISO,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    title,
    setTitle,
    participants,
    setParticipants,
    levelId,
    setLevelId,
    levels: levels ?? [],
    selectableResources,
    selectableLevels,
    mode,
    retro,
    retroAllowed,
    participantsValid,
    canSave,
    dirty,
    busy,
    save,
    reset,
  }
}

// ---------------------------------------------------------------------------
// Felterne. Samme markup begge steder — kun grupperingen er forskellig.
// ---------------------------------------------------------------------------

export function BookingResourceField({ form }: { form: BookingForm }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-label">{t('bookingFlow.resource')}</Label>
      <Select value={form.resourceId} onValueChange={form.setResourceId}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t('bookingFlow.pickResource')} />
        </SelectTrigger>
        <SelectContent>
          {form.selectableResources.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name}
              {r.location ? ` · ${r.location}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function BookingEmployeeField({ form }: { form: BookingForm }) {
  const { t } = useTranslation()
  const { booking } = form
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-label">{t('bookingFlow.employee')}</Label>
      {booking && form.editEmployeeKept && !form.employee ? (
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[13px]">
          <span>{booking.employee?.full_name ?? t('bookingFlow.unknownEmployee')}</span>
          <Button size="sm" variant="ghost" onClick={() => form.setEditEmployeeKept(false)}>
            {t('common.change')}
          </Button>
        </div>
      ) : (
        form.companyId && (
          <EmployeePicker
            companyId={form.companyId}
            value={form.employee}
            onChange={form.setEmployee}
          />
        )
      )}
    </div>
  )
}

export function BookingTimeFields({ form }: { form: BookingForm }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-2">
        <Label className="text-label">{t('bookingFlow.fromDate')}</Label>
        <Input
          type="date"
          value={form.dateISO}
          onChange={(e) => {
            form.setDateISO(e.target.value)
            // Slutdatoen følger med, så et almindeligt møde kun kræver ét datovalg.
            if (e.target.value && (!form.endDateISO || form.endDateISO < e.target.value))
              form.setEndDateISO(e.target.value)
          }}
        />
      </div>
      {form.mode === 'timed' && (
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingFlow.fromTime')}</Label>
          <Input
            type="time"
            value={form.startTime}
            onChange={(e) => form.setStartTime(e.target.value)}
          />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label className="text-label">{t('bookingFlow.toDate')}</Label>
        <Input
          type="date"
          value={form.endDateISO}
          onChange={(e) => form.setEndDateISO(e.target.value)}
        />
      </div>
      {form.mode === 'timed' && (
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingFlow.toTime')}</Label>
          <Input
            type="time"
            value={form.endTime}
            onChange={(e) => form.setEndTime(e.target.value)}
          />
        </div>
      )}
    </div>
  )
}

/** Formål + kursister + niveau (EVU A-05). */
export function BookingPurposeFields({ form, idPrefix }: { form: BookingForm; idPrefix: string }) {
  const { t } = useTranslation()
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-title`} className="text-label">
          {t('bookingFlow.title')}
        </Label>
        <Input
          id={`${idPrefix}-title`}
          value={form.title}
          maxLength={200}
          placeholder={t('bookingFlow.titlePlaceholder')}
          onChange={(e) => form.setTitle(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-participants`} className="text-label">
            {t('bookingFlow.participants')}
          </Label>
          <Input
            id={`${idPrefix}-participants`}
            type="number"
            min={1}
            max={100000}
            inputMode="numeric"
            value={form.participants}
            placeholder={t('bookingFlow.participantsPlaceholder')}
            onChange={(e) => form.setParticipants(e.target.value)}
            aria-invalid={!form.participantsValid}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingFlow.level')}</Label>
          <Select value={form.levelId} onValueChange={form.setLevelId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_LEVEL}>{t('bookingFlow.levelNone')}</SelectItem>
              {form.selectableLevels.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                  {l.is_active ? '' : ` (${t('bookingFlow.levelInactive')})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.levels.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('bookingFlow.levelEmptyHint')}</p>
          )}
        </div>
      </div>
    </>
  )
}

export function BookingRetroNotice({ form }: { form: BookingForm }) {
  const { t } = useTranslation()
  if (!form.retro) return null
  return form.retroAllowed ? (
    <p className="rounded-md border border-status-neutral-to-bad/50 bg-status-neutral-to-bad/10 px-3 py-2 text-[13px] text-status-neutral-to-bad">
      {t('bookingFlow.retroWarning')}
    </p>
  ) : (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
      {t('bookingFlow.retroBlocked')}
    </p>
  )
}

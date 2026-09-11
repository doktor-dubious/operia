import { useState } from 'react'
import { addDays, parseISODate, toISODate } from '@/lib/calendar'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
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
import { formatMoney, useCompanyCurrency } from '@/lib/booking-services'
import {
  TARIFF_UNITS,
  isCurrentTariff,
  type TariffRow,
  type TariffScope,
} from '@/lib/booking-tariffs'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Prislisten for én ressource, ydelse eller ét kursistniveau (EVU-krav C-05).
//
// Rækkerne gemmes én ad gangen som i niveaulisten: en takst er en kendsgerning
// med en gyldighedsperiode, ikke et udkast, der venter på en gem-knap.
//
// En takst RETTES ikke, når prisen ændrer sig — man sætter en slutdato på den
// gamle og opretter en ny. Det er hele pointen i kravet: en overskrevet pris
// tager historien med sig, og dermed grundlaget for det, der allerede er
// faktureret. Skærmen gør derfor det rigtige nemt: "Ny pris fra…" lukker den
// nuværende takst dagen før og opretter den næste i én bevægelse.

type Props = {
  companyId: string
  scope: TariffScope
  targetId: string
  /** Ydelser har allerede en fast pris; taksten er en tidsbegrænset undtagelse. */
  basePriceHint?: string
}

// Lokale datoer (som kalenderen), ikke UTC: kl. 00:30 dansk tid er UTC-dagen
// stadig i går, og "fra i dag" ville blive fra i går.
const today = () => toISODate(new Date())
const dayBefore = (iso: string) => toISODate(addDays(parseISODate(iso), -1))

export function BookingTariffFields({ companyId, scope, targetId, basePriceHint }: Props) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const currency = useCompanyCurrency(companyId)
  const [unit, setUnit] = useState<string>(scope === 'level' ? 'person' : 'day')
  const [amount, setAmount] = useState('')
  const [from, setFrom] = useState(today())
  const [busy, setBusy] = useState(false)

  const key = ['booking-tariffs', companyId, targetId]
  const { data: rows } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_tariffs')
        .select('id, scope, unit, amount, valid_from, valid_to, note')
        .eq('company_id', companyId)
        .eq('target_id', targetId)
        .order('valid_from', { ascending: false })
      if (error) throw error
      return (data ?? []) as TariffRow[]
    },
  })

  const refresh = () => void queryClient.invalidateQueries({ queryKey: key })

  const add = async () => {
    const value = Number(amount.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) {
      toast.error(t('bookingTariffs.errAmount'))
      return
    }
    setBusy(true)
    // Den nuværende takst med samme enhed lukkes dagen før den nye starter.
    // Uden det ville basens overlapsværn afvise indsættelsen — og med rette.
    const current = (rows ?? []).find((r) => r.unit === unit && isCurrentTariff(r, from))
    if (current && current.valid_from >= from) {
      setBusy(false)
      toast.error(t('bookingTariffs.errFromTooEarly', { date: current.valid_from }))
      return
    }
    if (current) {
      const { error } = await supabase
        .from('booking_tariffs')
        .update({ valid_to: dayBefore(from) })
        .eq('id', current.id)
      if (error) {
        setBusy(false)
        toast.error(describeError(error, t))
        return
      }
    }
    const { error } = await supabase.from('booking_tariffs').insert({
      company_id: companyId,
      scope,
      resource_id: scope === 'resource' ? targetId : null,
      service_id: scope === 'service' ? targetId : null,
      level_id: scope === 'level' ? targetId : null,
      unit,
      amount: value,
      valid_from: from,
    })
    setBusy(false)
    if (error) {
      // 23P01 = exclusion_violation: to takster med samme enhed i samme periode.
      if (error.code === '23P01') toast.error(t('bookingTariffs.errOverlap'))
      else toast.error(describeError(error, t))
      return
    }
    setAmount('')
    refresh()
  }

  const remove = async (id: string) => {
    setBusy(true)
    const { error } = await supabase.from('booking_tariffs').delete().eq('id', id)
    setBusy(false)
    if (error) toast.error(describeError(error, t))
    else refresh()
  }

  const list = rows ?? []

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {t('bookingTariffs.intro')}
        {basePriceHint ? ` ${basePriceHint}` : ''}
      </p>

      {list.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
          {t('bookingTariffs.empty')}
        </p>
      ) : (
        <div className="flex flex-col rounded-md border">
          {list.map((r) => {
            const current = isCurrentTariff(r)
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 border-b px-3 py-2 text-[13px] last:border-b-0"
              >
                <span className={cn('w-28 tabular-nums', !current && 'text-muted-foreground')}>
                  {formatMoney(r.amount, currency, i18n.language)}
                </span>
                <span className="w-32 text-muted-foreground">
                  {t(`bookingTariffs.unit.${r.unit}`, r.unit)}
                </span>
                <span
                  className={cn(
                    'flex-1 tabular-nums text-xs',
                    current ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {r.valid_from} – {r.valid_to ?? t('bookingTariffs.open')}
                  {current ? ` · ${t('bookingTariffs.current')}` : ''}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={busy}
                  aria-label={t('common.delete')}
                  onClick={() => void remove(r.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">{t('bookingTariffs.amount')}</Label>
          <Input
            className="w-32"
            inputMode="decimal"
            value={amount}
            placeholder="0,00"
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">{t('bookingTariffs.unitLabel')}</Label>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TARIFF_UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {t(`bookingTariffs.unit.${u}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-label">{t('bookingTariffs.validFrom')}</Label>
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <Button size="sm" disabled={busy || !amount.trim()} onClick={() => void add()}>
          <Plus className="size-4" />
          {t('bookingTariffs.add')}
        </Button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { bookingRpcErrorKey, invalidateBookingQueries, type BookingHit } from '@/lib/booking'
import {
  BOOKING_SERVICE_LINE_SELECT,
  formatMoney,
  lineTotal,
  linesTotal,
  useCompanyCurrency,
  type BookingServiceLine,
} from '@/lib/booking-services'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Tilkøbsydelser på en booking (EVU-krav A-06): linjerne med antal og pris,
// plus knappen der lægger en ny til fra kundens ydelsesliste.
//
// Al skrivning går gennem RPC'erne add_/update_/remove_booking_service, som
// gentjekker rettigheder OG at bookingen stadig er åben — en faktureret
// booking afvises server-side, uanset at panelet allerede skjuler knapperne.

function useLines(bookingId: string) {
  return useQuery({
    queryKey: ['booking-service-lines', bookingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_service_lines')
        .select(BOOKING_SERVICE_LINE_SELECT)
        .eq('booking_id', bookingId)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as BookingServiceLine[]
    },
  })
}

function useServiceCatalog(companyId: string | null) {
  return useQuery({
    queryKey: ['booking-services', 'catalog', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_services')
        .select('id, name, has_quantity, price_mode, unit_price, is_active')
        .eq('company_id', companyId!)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

export function BookingServicesTab({
  booking,
  companyId,
  /** Låst = annulleret eller faktureret; linjerne kan kun læses. */
  locked,
}: {
  booking: BookingHit
  companyId: string | null
  locked: boolean
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const currency = useCompanyCurrency(companyId)
  const { data: lines } = useLines(booking.id)
  const { data: catalog } = useServiceCatalog(companyId)
  const [addOpen, setAddOpen] = useState(false)
  const [pickId, setPickId] = useState('')
  const [pickQty, setPickQty] = useState('1')
  const [busy, setBusy] = useState(false)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['booking-service-lines', booking.id] })
    invalidateBookingQueries(queryClient)
  }

  const fail = (error: { message?: string }) => {
    const key = bookingRpcErrorKey(error)
    toast.error(key ? t(key) : describeError(error, t))
  }

  const picked = (catalog ?? []).find((s) => s.id === pickId) ?? null
  // En ydelse der allerede ligger på bookingen kan ikke lægges på igen —
  // antallet er multiplikatoren (unik (booking_id, service_id) i basen).
  const available = (catalog ?? []).filter(
    (s) => !(lines ?? []).some((l) => l.service_id === s.id),
  )

  const add = async () => {
    if (!pickId || busy) return
    setBusy(true)
    const { error } = await supabase.rpc('add_booking_service', {
      p_booking_id: booking.id,
      p_service_id: pickId,
      p_quantity: picked?.has_quantity ? Math.max(1, Number(pickQty) || 1) : 1,
    })
    setBusy(false)
    if (error) return fail(error)
    setAddOpen(false)
    setPickId('')
    setPickQty('1')
    refresh()
  }

  const setQuantity = async (line: BookingServiceLine, quantity: number) => {
    if (!Number.isInteger(quantity) || quantity < 1) return
    if (quantity === line.quantity) return
    const { error } = await supabase.rpc('update_booking_service', {
      p_line_id: line.id,
      p_quantity: quantity,
    })
    if (error) return fail(error)
    refresh()
  }

  const remove = async (line: BookingServiceLine) => {
    const { error } = await supabase.rpc('remove_booking_service', { p_line_id: line.id })
    if (error) return fail(error)
    refresh()
  }

  const rows = lines ?? []

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t('bookingServices.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((line) => (
            <div
              key={line.id}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px]">{line.service?.name ?? '—'}</span>
                <span className="text-xs text-muted-foreground">
                  {line.price_mode === 'unit'
                    ? t('bookingServices.perUnit', {
                        price: formatMoney(Number(line.unit_price), currency, i18n.language),
                      })
                    : t('bookingServices.fixed')}
                </span>
              </div>
              {line.price_mode === 'unit' ? (
                <Input
                  type="number"
                  min={1}
                  max={100000}
                  className="w-20"
                  defaultValue={line.quantity}
                  disabled={locked}
                  // Gemmes ved blur/Enter, ikke ved hvert tastetryk — ellers
                  // ville hvert ciffer være en RPC og en hændelse i loggen.
                  onBlur={(e) => void setQuantity(line, Number(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                />
              ) : (
                <span className="w-20 text-right text-xs text-muted-foreground">—</span>
              )}
              <span className="w-28 text-right text-[13px] tabular-nums">
                {formatMoney(lineTotal(line), currency, i18n.language)}
              </span>
              {!locked && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  aria-label={t('common.delete')}
                  onClick={() => void remove(line)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
          <div className="flex items-center justify-end gap-3 border-t border-border pt-2 text-[13px] font-medium">
            <span>{t('bookingServices.total')}</span>
            <span className="w-28 text-right tabular-nums">
              {formatMoney(linesTotal(rows), currency, i18n.language)}
            </span>
            {!locked && <span className="size-8" />}
          </div>
        </div>
      )}

      {!locked && (catalog ?? []).length === 0 && (
        <p className="text-xs text-muted-foreground">{t('bookingServices.emptyCatalog')}</p>
      )}

      {/* Knappen er dialogens egen trigger og ikke en onClick-håndtering:
          en almindelig knap åbner dialogen i samme hændelse, som Radix'
          yderklik-lag netop er begyndt at lytte på, og så kan dialogen nå at
          lukke sig selv igen med det samme. Med DialogTrigger håndterer Radix
          selv rækkefølgen. */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        {!locked && (
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              disabled={available.length === 0}
            >
              <Plus className="size-4" /> {t('bookingServices.add')}
            </Button>
          </DialogTrigger>
        )}
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('bookingServices.add')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('bookingServices.service')}</Label>
              <Select value={pickId} onValueChange={setPickId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('bookingServices.pickService')} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {formatMoney(Number(s.unit_price), currency, i18n.language)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {picked?.has_quantity && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="svc-qty" className="text-label">
                  {t('bookingServices.quantity')}
                </Label>
                <Input
                  id="svc-qty"
                  type="number"
                  min={1}
                  max={100000}
                  className="w-32"
                  value={pickQty}
                  onChange={(e) => setPickQty(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!pickId || busy} onClick={() => void add()}>
              {busy ? t('common.loading') : t('common.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

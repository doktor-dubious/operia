import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Coins, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/detail-field'
import { BookingTariffFields } from '@/components/booking-tariff-fields'
import { describeError } from '@/lib/errors'
import { invalidateBookingQueries } from '@/lib/booking'
import { supabase } from '@/lib/supabase'

// Kursistniveauer pr. virksomhed (EVU-krav A-05) — listen bookingdialogens
// niveau-vælger trækker på, og den taksterne hænges på, når krav C-07 bygges.
//
// Rækkerne gemmes ÉN AD GANGEN og med det samme, ikke gennem sidens gem-bjælke.
// Bjælken hører til virksomhedens to bookingindstillinger; en liste der deler
// den ville betyde, at "Fortryd" også rullede tilføjede og slettede niveauer
// tilbage — og at man skulle huske at gemme efter at have trykket på et
// skraldespandsikon, som tydeligvis allerede har gjort noget.

type LevelRow = { id: string; name: string; is_active: boolean; sort_order: number }

export function BookingLevelsFields({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  // Ét niveau ad gangen har sin prisliste foldet ud — listen skal stadig kunne
  // læses som en liste.
  const [priceFor, setPriceFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: rows } = useQuery({
    queryKey: ['booking-levels', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_participant_levels')
        .select('id, name, is_active, sort_order')
        .eq('company_id', companyId)
        .order('sort_order')
        .order('name')
      if (error) throw error
      return (data ?? []) as LevelRow[]
    },
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['booking-levels', companyId] })
    // Bookinglisten viser niveauets NAVN, så en omdøbning skal slå igennem der.
    invalidateBookingQueries(queryClient)
  }

  const fail = (error: { code?: string; message?: string }) => {
    // 23505 = unikke (company_id, name); 23503 = niveauet er i brug på en
    // booking, og fremmednøglen er 'restrict' med vilje (se migrationen).
    if (error.code === '23505') toast.error(t('bookingLevels.errDuplicate'))
    else if (error.code === '23503') toast.error(t('bookingLevels.errInUse'))
    else toast.error(describeError(error, t))
  }

  const add = async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    const { error } = await supabase.from('booking_participant_levels').insert({
      company_id: companyId,
      name,
      // Nye niveauer lægges bagest; rækkefølgen i listen ER sorteringen.
      sort_order: (rows?.length ?? 0) + 1,
    })
    setBusy(false)
    if (error) return fail(error)
    setNewName('')
    refresh()
  }

  const rename = async (row: LevelRow, name: string) => {
    const next = name.trim()
    if (!next || next === row.name) return
    const { error } = await supabase
      .from('booking_participant_levels')
      .update({ name: next })
      .eq('id', row.id)
    if (error) return fail(error)
    refresh()
  }

  const setActive = async (row: LevelRow, is_active: boolean) => {
    const { error } = await supabase
      .from('booking_participant_levels')
      .update({ is_active })
      .eq('id', row.id)
    if (error) return fail(error)
    refresh()
  }

  const remove = async (row: LevelRow) => {
    const { error } = await supabase
      .from('booking_participant_levels')
      .delete()
      .eq('id', row.id)
    if (error) return fail(error)
    toast.success(t('bookingLevels.deletedToast', { name: row.name }))
    refresh()
  }

  return (
    <Field label={t('bookingLevels.title')} info={t('bookingLevels.hint')}>
      <div className="flex flex-col gap-2">
        {(rows ?? []).map((row) => (
          <div key={row.id} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              defaultValue={row.name}
              maxLength={80}
              className="flex-1"
              // Omdøbning gemmes ved blur eller Enter — ikke ved hvert tastetryk.
              onBlur={(e) => void rename(row, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
            <Label className="flex items-center gap-1.5 px-1 text-xs font-normal text-muted-foreground">
              <Checkbox
                checked={row.is_active}
                onCheckedChange={(v) => void setActive(row, v === true)}
              />
              {t('bookingLevels.active')}
            </Label>
            <Button
              size="icon"
              variant="ghost"
              className={
                priceFor === row.id
                  ? 'size-8 text-foreground'
                  : 'size-8 text-muted-foreground hover:text-foreground'
              }
              aria-label={t('bookingTariffs.tab')}
              onClick={() => setPriceFor(priceFor === row.id ? null : row.id)}
            >
              <Coins className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-muted-foreground hover:text-destructive"
              aria-label={t('common.delete')}
              onClick={() => void remove(row)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
          {priceFor === row.id && (
            <div className="ml-1 border-l pl-4">
              <BookingTariffFields companyId={companyId} scope="level" targetId={row.id} />
            </div>
          )}
          </div>
        ))}

        <div className="flex items-center gap-2">
          <Input
            value={newName}
            maxLength={80}
            className="flex-1"
            placeholder={t('bookingLevels.namePlaceholder')}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void add()
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!newName.trim() || busy}
            onClick={() => void add()}
          >
            <Plus className="size-4" /> {t('common.add')}
          </Button>
        </div>
      </div>
    </Field>
  )
}

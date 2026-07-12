import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarIcon, X } from 'lucide-react'
import { da } from 'react-day-picker/locale'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// Udløbsdato-vælger til produkt-/funktionstildelinger: knap med dato (eller
// "Intet udløb") der åbner en kalender-popover. Værdien er en ISO-dato
// (YYYY-MM-DD) eller null = uden udløb.

const format = new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium' })

export function ExpiryDatePicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selected = value ? new Date(`${value}T00:00:00`) : undefined
  const expired = !!value && value < new Date().toISOString().slice(0, 10)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            'h-8 w-36 justify-start px-2.5 font-normal',
            !value && 'text-muted-foreground',
            expired && 'border-destructive/50 text-destructive',
          )}
          title={t('productsPage.expiry')}
        >
          <CalendarIcon className="size-3.5" />
          <span className="truncate">
            {selected ? format.format(selected) : t('productsPage.noExpiry')}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          locale={da}
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            // Lokal dato (ikke toISOString — den kan skride en dag pga. UTC).
            onChange(
              date
                ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                : null,
            )
            setOpen(false)
          }}
        />
        {value && (
          <div className="border-t border-border p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
            >
              <X className="size-3.5" /> {t('productsPage.clearExpiry')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

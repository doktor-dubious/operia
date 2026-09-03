import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { BOOKING_CATEGORY_COLOR_COUNT, bookingCategoryColors } from '@/lib/booking'
import { cn } from '@/lib/utils'

// Farvevælger til bookingkategorier. Bevidst en fast palet og ikke en fri
// hex-vælger: hver plads i paletten har en forudberegnet tekstkontrast
// (--booking-category-N-fg), som en vilkårlig farve ville bryde uden at nogen
// opdagede det — bjælketeksten ville bare blive ulæselig for nogle kategorier.
export function BookingColorPicker({
  value,
  onChange,
  allowAuto = false,
  disabled = false,
}: {
  /** Paletindeks 0-12, eller null = ikke valgt (auto). */
  value: number | null
  onChange: (next: number | null) => void
  /** Vis et "automatisk"-felt — kun ved oprettelse, hvor serveren vælger. */
  allowAuto?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowAuto && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          title={t('bookingCategoriesPage.colorAuto')}
          className={cn(
            'flex h-7 items-center rounded-[4px] border border-border px-2 text-[11px] font-medium transition-colors',
            'hover:bg-accent disabled:opacity-50',
            value === null && 'border-foreground/40 bg-accent',
          )}
        >
          {t('bookingCategoriesPage.colorAuto')}
        </button>
      )}
      {Array.from({ length: BOOKING_CATEGORY_COLOR_COUNT }, (_, i) => {
        const swatch = bookingCategoryColors(i)
        const selected = value === i
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onChange(i)}
            aria-pressed={selected}
            aria-label={t('bookingCategoriesPage.colorOption', { n: i + 1 })}
            title={t('bookingCategoriesPage.colorOption', { n: i + 1 })}
            className={cn(
              'flex size-7 items-center justify-center rounded-[4px] transition-transform',
              // Ringen sidder uden på feltet, så den er synlig uanset hvor lys
              // eller mørk farven er — en indvendig kant forsvinder i begge ender.
              'outline-offset-2 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100',
              selected && 'outline-2 outline-foreground',
            )}
            style={{ backgroundColor: swatch.background }}
          >
            {selected && <Check className="size-3.5" style={{ color: swatch.color }} />}
          </button>
        )
      })}
    </div>
  )
}

import { useRef } from 'react'
import { cn } from '@/lib/utils'

// HH:MM-tidsvælger (openstatushq/shadcn-mønster): to segmenter — timer og
// minutter — der ser ud som ét inputfelt. Piletaster op/ned tæller op/ned (med
// ombrydning), cifre skrives direkte og springer automatisk fra timer til
// minutter. Værdien er altid en gyldig 24-timers "HH:MM"-streng.

const pad = (n: number) => String(n).padStart(2, '0')
const clamp = (n: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0)

function parse(value: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{1,2})/.exec(value ?? '')
  return { h: match ? clamp(+match[1], 23) : 0, m: match ? clamp(+match[2], 59) : 0 }
}

export function TimePicker({
  value,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: {
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  disabled?: boolean
  className?: string
}) {
  const { h, m } = parse(value || '00:00')
  const hoursRef = useRef<HTMLInputElement>(null)
  const minutesRef = useRef<HTMLInputElement>(null)

  const emit = (nh: number, nm: number) => onChange(`${pad(nh)}:${pad(nm)}`)

  const change = (seg: 'h' | 'm', raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(-2)
    const n = digits === '' ? 0 : parseInt(digits, 10)
    if (seg === 'h') {
      const nh = clamp(n, 23)
      emit(nh, m)
      // Kan ikke skrive flere time-cifre → spring til minutter.
      if (digits.length === 2 || n > 2) minutesRef.current?.focus()
    } else {
      emit(h, clamp(n, 59))
    }
  }

  const key = (seg: 'h' | 'm', e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (seg === 'h') emit((h + 1) % 24, m)
      else emit(h, (m + 1) % 60)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (seg === 'h') emit((h + 23) % 24, m)
      else emit(h, (m + 59) % 60)
    } else if ((e.key === ':' || e.key === 'ArrowRight') && seg === 'h') {
      e.preventDefault()
      minutesRef.current?.focus()
    } else if (e.key === 'ArrowLeft' && seg === 'm') {
      e.preventDefault()
      hoursRef.current?.focus()
    }
  }

  const seg =
    'w-6 bg-transparent text-center tabular-nums outline-none disabled:cursor-not-allowed'

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-8 items-center rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors',
        'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        disabled && 'pointer-events-none opacity-50',
        'dark:bg-input/30',
        className,
      )}
    >
      <input
        ref={hoursRef}
        type="text"
        inputMode="numeric"
        maxLength={2}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} — timer` : 'Timer'}
        value={pad(h)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => change('h', e.target.value)}
        onKeyDown={(e) => key('h', e)}
        className={seg}
      />
      <span className="text-muted-foreground">:</span>
      <input
        ref={minutesRef}
        type="text"
        inputMode="numeric"
        maxLength={2}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} — minutter` : 'Minutter'}
        value={pad(m)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => change('m', e.target.value)}
        onKeyDown={(e) => key('m', e)}
        className={seg}
      />
    </div>
  )
}

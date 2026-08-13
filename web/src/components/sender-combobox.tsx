import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// Afsender-felt til intake (spec Flow 1: valgfri afsender): fri tekst OG
// dropdown i ét. Klik på pilen (eller fokus i feltet) viser virksomhedens
// tidligere afsendere; at skrive filtrerer listen, og teksten kan altid gemmes
// som den er — nye navne (fx "TDC") lander i parcels.sender og dukker op i
// listen fremover. Samme mønster som EmployeePicker (input + absolut liste).

export function SenderCombobox({
  id,
  value,
  onChange,
  suggestions,
  className,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  // Ekstra klasser på selve inputtet (fx AI-markeringen på modtag-formularen).
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Pil-tasterne fremhæver et forslag; Enter vælger det (i stedet for at
  // sende formularen). -1 = intet fremhævet.
  const [highlight, setHighlight] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const query = value.trim().toLowerCase()
  const filtered = query
    ? suggestions.filter((s) => s.toLowerCase().includes(query))
    : suggestions

  const show = (openList: boolean) => {
    setOpen(openList)
    setHighlight(-1)
  }

  const pick = (name: string) => {
    onChange(name)
    show(false)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || filtered.length === 0) {
      if (e.key === 'ArrowDown' && filtered.length > 0) {
        e.preventDefault()
        show(true)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((i) => (i + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((i) => (i <= 0 ? filtered.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      // Enter med listen åben må aldrig sende formularen: vælg det fremhævede
      // forslag, ellers luk blot listen og behold den indtastede tekst.
      e.preventDefault()
      if (highlight >= 0) pick(filtered[highlight])
      else show(false)
    } else if (e.key === 'Escape') {
      show(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <Input
        id={id}
        ref={inputRef}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        placeholder={t('receive.senderPlaceholder')}
        className={cn('pr-8', className)}
        onChange={(e) => {
          onChange(e.target.value)
          show(suggestions.length > 0)
        }}
        onFocus={() => suggestions.length > 0 && show(true)}
        onKeyDown={onKeyDown}
      />
      {suggestions.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('receive.senderShowAll')}
          className="absolute inset-y-0 right-0 flex w-8 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => {
            // mousedown (ikke click): ellers når outside-click-lytteren at
            // lukke listen, før klikket registreres som toggle.
            e.preventDefault()
            show(!open)
            inputRef.current?.focus()
          }}
        >
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      )}
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
          {filtered.map((name, i) => (
            <li key={name}>
              <button
                type="button"
                className={cn(
                  'w-full cursor-pointer px-3 py-1.5 text-left text-[13px] hover:bg-accent',
                  i === highlight && 'bg-accent',
                )}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(name)}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

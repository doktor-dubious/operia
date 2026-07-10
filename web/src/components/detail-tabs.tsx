import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Fanelinje til detaljepanelet (gorm.ai-mønsteret): faner deler bredden,
// en streg glider under den valgte fane, og indholdet fader blødt ind.

export type DetailTab = { key: string; label: string }

export function DetailTabs({
  tabs,
  active,
  onChange,
  onClose,
  children,
}: {
  tabs: DetailTab[]
  active: string
  onChange: (key: string) => void
  onClose?: () => void
  children: React.ReactNode
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [bar, setBar] = useState({ left: 0, width: 0 })

  useEffect(() => {
    const el = refs.current[active]
    if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth })
  }, [active, tabs])

  return (
    <div className="border-t border-border">
      <div className="relative flex items-center border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[tab.key] = el
            }}
            type="button"
            className={cn(
              'flex-1 cursor-pointer py-2.5 text-center text-[13px] font-[450] transition-colors duration-200',
              active === tab.key
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground-light',
            )}
            onClick={() => onChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="mr-1 h-7 w-7 shrink-0"
            onClick={onClose}
            aria-label="✕"
          >
            <X className="size-4" />
          </Button>
        )}
        <span
          className="absolute bottom-0 h-0.5 bg-foreground transition-all duration-300 ease-out"
          style={{ left: bar.left, width: bar.width }}
        />
      </div>
      {/* key-remount + fade-in giver den lille overgangsforsinkelse ved faneskift */}
      <div key={active} className="animate-in fade-in py-6 duration-300">
        {children}
      </div>
    </div>
  )
}

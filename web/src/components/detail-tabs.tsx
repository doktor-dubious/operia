import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { Maximize } from '@/components/animate-ui/icons/maximize'
import { Minimize } from '@/components/animate-ui/icons/minimize'
import { Button } from '@/components/ui/button'
import { useDetailMaximized } from '@/hooks/use-detail-maximized'
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
  const { t } = useTranslation()
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [bar, setBar] = useState({ left: 0, width: 0 })
  const [maximized, toggleMaximized] = useDetailMaximized()

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
        {/* Maksimér/gendan: skjuler tabellen over panelet så det fylder højden */}
        <AnimateIcon animateOnHover asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={toggleMaximized}
            aria-label={maximized ? t('detail.restore') : t('detail.maximize')}
            title={maximized ? t('detail.restore') : t('detail.maximize')}
          >
            {maximized ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </Button>
        </AnimateIcon>
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

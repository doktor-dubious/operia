import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { Blocks } from '@/components/animate-ui/icons/blocks'
import { useCompany } from '@/components/company-provider'
import { cn } from '@/lib/utils'

// Virksomhedsskifter (gorm.ai's customer switcher-mønster): bjælke i side-
// menuen under logoet; dropdown i portal med søgning (cmdk), senest brugte
// øverst. Tenant-brugere og én-virksomheds-tilfælde viser en statisk bjælke.
// compact-varianten (moderne skinne) viser kun ikonet; dropdown i fast bredde.

const DROPDOWN_HEIGHT = 320
const COMPACT_WIDTH = 260

export function CompanySwitcher({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const { companies, activeCompany, recentCompanies, isTenantUser, isPending, setActiveCompanyId } =
    useCompany()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  // Placér dropdown under triggeren; flip ovenover hvis den rammer bunden
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow >= DROPDOWN_HEIGHT ? rect.bottom + 2 : rect.top - DROPDOWN_HEIGHT - 2
    setPos({
      top: Math.max(0, top),
      left: rect.left,
      width: compact ? COMPACT_WIDTH : rect.width,
    })
  }, [open, compact])

  const onOutsideClick = useCallback((e: MouseEvent) => {
    if (
      dropdownRef.current &&
      !dropdownRef.current.contains(e.target as Node) &&
      triggerRef.current &&
      !triggerRef.current.contains(e.target as Node)
    ) {
      setOpen(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [open, onOutsideClick])

  const barClass = cn(
    'flex w-full items-center gap-2 border-b border-border bg-primary text-primary-foreground',
    compact ? 'justify-center px-0 py-2' : 'px-3 py-2',
  )

  // Kun superbrugere (platform-admins) ser virksomhedsvælgeren; tenant-brugere
  // er bundet til én virksomhed og får ingen vælger overhovedet.
  if (isPending || isTenantUser || !activeCompany) return null

  // Platform-admin med kun én virksomhed: statisk bjælke
  if (companies.length <= 1) {
    return (
      <div className={barClass} title={activeCompany.name}>
        <Blocks size={16} className="shrink-0" />
        {!compact && <span className="truncate text-xs">{activeCompany.name}</span>}
      </div>
    )
  }

  const recentIds = new Set(recentCompanies.map((c) => c.id))
  const others = companies.filter((c) => !recentIds.has(c.id))

  const select = (id: string) => {
    setActiveCompanyId(id)
    setOpen(false)
  }

  return (
    <>
      <AnimateIcon animateOnHover asChild>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={compact ? activeCompany.name : undefined}
          className={cn(barClass, 'cursor-pointer transition-colors outline-none hover:bg-primary/90')}
        >
          <Blocks size={16} className="shrink-0" />
          {!compact && (
            <>
              <span className="flex-1 truncate text-left text-xs">{activeCompany.name}</span>
              <ChevronDown className="h-3 w-3 shrink-0" />
            </>
          )}
        </button>
      </AnimateIcon>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className="z-[9999] isolate rounded-md border border-border bg-popover text-popover-foreground shadow-2xl"
          >
            <Command className="bg-popover">
              <CommandInput placeholder={t('companySwitcher.search')} />
              <CommandList className="max-h-[260px]">
                <CommandEmpty>{t('companySwitcher.noResults')}</CommandEmpty>
                {recentCompanies.length > 0 && (
                  <CommandGroup heading={t('companySwitcher.recent')}>
                    {recentCompanies.map((company) => (
                      <CommandItem
                        key={company.id}
                        value={`recent-${company.name}`}
                        className="cursor-pointer text-xs"
                        onSelect={() => select(company.id)}
                      >
                        {company.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {recentCompanies.length > 0 && others.length > 0 && <CommandSeparator />}
                <CommandGroup heading={t('companySwitcher.all')}>
                  {others.map((company) => (
                    <CommandItem
                      key={company.id}
                      value={company.name}
                      className={cn(
                        'cursor-pointer text-xs',
                        company.id === activeCompany.id && 'font-medium',
                      )}
                      onSelect={() => select(company.id)}
                    >
                      {company.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>,
          document.body,
        )}
    </>
  )
}

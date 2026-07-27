import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import type { ConfigNavSection } from '@/lib/nav'
import { cn } from '@/lib/utils'

// Sekundær venstremenu til Operia- og Konfigurér-siderne: en titel + grupperede
// sektioner. Sektionerne kan foldes op/ned ved klik på overskriften — samme
// mønster som de klassiske sidemenugrupper (chevron + grid-rows-animation), og
// valget huskes i localStorage pr. menu (storageKey).
export function ConfigSideNav({
  title,
  sectionNs,
  sections,
  storageKey,
}: {
  title: string
  // i18n-namespace for sektionsoverskrifterne (fx 'operiaConfig'); punkterne
  // slås altid op under nav.*.
  sectionNs: string
  sections: ConfigNavSection[]
  storageKey: string
}) {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(storageKey) ?? '[]'))
    } catch {
      return new Set<string>()
    }
  })
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify([...collapsed]))
  }, [collapsed, storageKey])
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <aside className="w-56 shrink-0 select-none border-r border-border pr-2">
      <h2 className="px-3 pb-5 text-[13px] font-semibold">{title}</h2>
      {sections.map((section, i) => {
        const isCollapsed = collapsed.has(section.labelKey)
        return (
          <div key={section.labelKey} className={cn(i > 0 && 'pt-5')}>
            <button
              type="button"
              onClick={() => toggle(section.labelKey)}
              className="flex w-full cursor-pointer items-center gap-1 px-3 pb-1 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              <span className="whitespace-nowrap">{t(`${sectionNs}.${section.labelKey}`)}</span>
              <ChevronDown
                className={cn(
                  'ml-auto size-3.5 shrink-0 transition-transform duration-200',
                  isCollapsed && '-rotate-90',
                )}
              />
            </button>
            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-200 ease-out',
                isCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
              )}
            >
              <div className="overflow-hidden">
                <nav className="flex flex-col gap-0.5">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      to={item.href}
                      className={cn(
                        'block rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                        pathname === item.href && 'bg-accent text-foreground',
                      )}
                    >
                      {t(`nav.${item.labelKey}`)}
                    </Link>
                  ))}
                </nav>
              </div>
            </div>
          </div>
        )
      })}
    </aside>
  )
}

import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { LayoutDashboard } from '@/components/animate-ui/icons/layout-dashboard'
import { LogOut } from '@/components/animate-ui/icons/log-out'
import { Moon } from '@/components/animate-ui/icons/moon'
import { Settings } from '@/components/animate-ui/icons/settings'
import { Sun } from '@/components/animate-ui/icons/sun'
import { SunMoon } from '@/components/animate-ui/icons/sun-moon'
import { useTheme } from '@/components/theme-provider'
import { coreNav, productNav, settingsNav } from '@/lib/nav'
import { supabase } from '@/lib/supabase'

// Menuindhold i compliance-circle-stil: overvejende tekst uden ikoner; de få
// ikoner er animate-ui-ikoner til HØJRE via DropdownMenuShortcut, og
// <AnimateIcon animateOnHover> lader dem animere når punktet hoveres.
// Sektionsoverskrifter er små, dæmpede og uppercase.

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-tight text-muted-foreground/60">
      {children}
    </DropdownMenuLabel>
  )
}

function ThemeRow() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
  const Icon = theme === 'system' ? SunMoon : theme === 'light' ? Sun : Moon
  return (
    <AnimateIcon animateOnHover asChild>
      <DropdownMenuLabel
        className="flex cursor-pointer font-normal text-muted-foreground"
        onClick={() => setTheme(next)}
      >
        {t('nav.theme')} · {t(`theme.${theme}`)}
        <span className="ml-auto">
          <Icon size={16} />
        </span>
      </DropdownMenuLabel>
    </AnimateIcon>
  )
}

export function UserNavDropdownContent({
  includeNav,
  side = 'top',
  align = 'start',
}: {
  includeNav: boolean
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const go = (href: string) => navigate({ to: href })

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate({ to: '/login' })
  }

  return (
    <DropdownMenuContent side={side} align={align} className="my-1 w-56 font-normal">
      {includeNav && (
        <>
          <AnimateIcon animateOnHover asChild>
            <DropdownMenuItem className="cursor-pointer" onClick={() => go('/')}>
              {t('nav.dashboard')}
              <DropdownMenuShortcut>
                <LayoutDashboard size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </AnimateIcon>
          <DropdownMenuSeparator />
          <SectionLabel>{t('nav.groupCore')}</SectionLabel>
          {coreNav
            .filter((item) => item.href !== '/')
            .map((item) => (
              <DropdownMenuItem
                key={item.href}
                className="cursor-pointer"
                onClick={() => go(item.href)}
              >
                {t(`nav.${item.labelKey}`)}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <SectionLabel>{t('nav.groupProducts')}</SectionLabel>
          {productNav.map((item) => (
            <DropdownMenuItem
              key={item.href}
              className="cursor-pointer"
              onClick={() => go(item.href)}
            >
              {t(`nav.${item.labelKey}`)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
        </>
      )}
      <ThemeRow />
      <AnimateIcon animateOnHover asChild>
        <DropdownMenuItem className="cursor-pointer" onClick={() => go(settingsNav.href)}>
          {t('nav.settings')}
          <DropdownMenuShortcut>
            <Settings size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </AnimateIcon>
      <DropdownMenuSeparator />
      <AnimateIcon animateOnHover asChild>
        <DropdownMenuItem className="cursor-pointer" onClick={signOut}>
          {t('auth.signOut')}
          <DropdownMenuShortcut>
            <LogOut size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </AnimateIcon>
    </DropdownMenuContent>
  )
}

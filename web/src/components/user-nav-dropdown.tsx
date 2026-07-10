import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard, LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/components/theme-provider'
import { coreNav, productNav, settingsNav } from '@/lib/nav'
import { supabase } from '@/lib/supabase'

// Menuindhold i compliance-circle-stil: overvejende tekst uden ikoner; de få
// ikoner sidder til HØJRE via DropdownMenuShortcut (ml-auto). Sektions-
// overskrifter er små, dæmpede og uppercase.

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
  const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon
  return (
    <DropdownMenuLabel
      className="flex cursor-pointer font-normal text-muted-foreground"
      onClick={() => setTheme(next)}
    >
      {t('nav.theme')} · {t(`theme.${theme}`)}
      <span className="ml-auto">
        <Icon className="h-4 w-4" />
      </span>
    </DropdownMenuLabel>
  )
}

export function UserNavDropdownContent({ includeNav }: { includeNav: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const go = (href: string) => navigate({ to: href })

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate({ to: '/login' })
  }

  return (
    <DropdownMenuContent side="top" align="start" className="mb-1 w-56 font-normal">
      {includeNav && (
        <>
          <DropdownMenuItem className="cursor-pointer" onClick={() => go('/')}>
            {t('nav.dashboard')}
            <DropdownMenuShortcut>
              <LayoutDashboard className="h-4 w-4" />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
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
      <DropdownMenuItem className="cursor-pointer" onClick={() => go(settingsNav.href)}>
        {t('nav.settings')}
        <DropdownMenuShortcut>
          <Settings className="h-4 w-4" />
        </DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="cursor-pointer" onClick={signOut}>
        {t('auth.signOut')}
        <DropdownMenuShortcut>
          <LogOut className="h-4 w-4" />
        </DropdownMenuShortcut>
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

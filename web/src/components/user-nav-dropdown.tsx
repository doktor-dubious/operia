import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { LayoutDashboard } from '@/components/animate-ui/icons/layout-dashboard'
import { LogOut } from '@/components/animate-ui/icons/log-out'
import { Sparkles } from '@/components/animate-ui/icons/sparkles'
import { User } from '@/components/animate-ui/icons/user'
import { useTheme } from '@/components/theme-provider'
import { useSession } from '@/hooks/use-session'
import { coreNav, productNav } from '@/lib/nav'
import { supabase } from '@/lib/supabase'

// Brugermenu struktureret som Supabase Studios (uden "Feature previews" og
// "Timezone" — bevidst udeladt): e-mail-header, Konto/Changelog med små
// dæmpede ikoner til venstre, tema som radiogruppe, log ud nederst.
// Nav-delen (moderne tilstand) beholder compliance-circle-stilen: tekst uden
// ikoner; de få ikoner til højre via DropdownMenuShortcut, animeret på hover.

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
      {children}
    </DropdownMenuLabel>
  )
}

function NavSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-tight text-muted-foreground/60">
      {children}
    </DropdownMenuLabel>
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
  const { session } = useSession()
  const { theme, setTheme } = useTheme()

  const go = (href: string) => navigate({ to: href })

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate({ to: '/login' })
  }

  return (
    <DropdownMenuContent side={side} align={align} className="my-1 w-64 font-normal">
      <DropdownMenuLabel className="truncate text-[13px] font-[450] text-foreground">
        {session?.user.email ?? t('app.name')}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {includeNav && (
        <>
          <AnimateIcon animateOnHover asChild>
            <DropdownMenuItem className="cursor-pointer text-xs font-[450] text-foreground-light" onClick={() => go('/')}>
              {t('nav.dashboard')}
              <DropdownMenuShortcut>
                <LayoutDashboard size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </AnimateIcon>
          <DropdownMenuSeparator />
          <NavSectionLabel>{t('nav.groupCore')}</NavSectionLabel>
          {coreNav
            .filter((item) => item.href !== '/')
            .map((item) => (
              <DropdownMenuItem
                key={item.href}
                className="cursor-pointer text-xs font-[450] text-foreground-light"
                onClick={() => go(item.href)}
              >
                {t(`nav.${item.labelKey}`)}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <NavSectionLabel>{t('nav.groupProducts')}</NavSectionLabel>
          {productNav.map((item) => (
            <DropdownMenuItem
              key={item.href}
              className="cursor-pointer text-xs font-[450] text-foreground-light"
              onClick={() => go(item.href)}
            >
              {t(`nav.${item.labelKey}`)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
        </>
      )}
      <AnimateIcon animateOnHover asChild>
        <DropdownMenuItem className="cursor-pointer text-xs font-[450] text-foreground-light gap-2" onClick={() => go('/settings')}>
          <User size={14} className="text-muted-foreground" />
          {t('menu.account')}
        </DropdownMenuItem>
      </AnimateIcon>
      <AnimateIcon animateOnHover asChild>
        <DropdownMenuItem
          className="cursor-pointer text-xs font-[450] text-foreground-light gap-2"
          onClick={() => toast.info(t('common.comingSoon'))}
        >
          <Sparkles size={14} className="text-muted-foreground" />
          {t('menu.changelog')}
        </DropdownMenuItem>
      </AnimateIcon>
      <DropdownMenuSeparator />
      <SectionLabel>{t('nav.theme')}</SectionLabel>
      <DropdownMenuRadioGroup
        value={theme}
        onValueChange={(v) => setTheme(v as 'system' | 'light' | 'dark')}
      >
        <DropdownMenuRadioItem className="cursor-pointer text-xs font-[450] text-foreground-light pl-4" value="system">
          {t('theme.system')}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem className="cursor-pointer text-xs font-[450] text-foreground-light pl-4" value="dark">
          {t('theme.dark')}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem className="cursor-pointer text-xs font-[450] text-foreground-light pl-4" value="light">
          {t('theme.light')}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <AnimateIcon animateOnHover asChild>
        <DropdownMenuItem className="cursor-pointer text-xs font-[450] text-foreground-light" onClick={signOut}>
          {t('auth.signOut')}
          <DropdownMenuShortcut>
            <LogOut size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </AnimateIcon>
    </DropdownMenuContent>
  )
}

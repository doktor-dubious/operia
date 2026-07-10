import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/components/theme-provider'
import { useUiSettings, type NavMode } from '@/components/ui-settings-provider'
import { useSession } from '@/hooks/use-session'
import { supabase } from '@/lib/supabase'

// Synkroniserer UI-præferencer (tema, navigation, sprog) med kontoen via
// auth user metadata, så valgene følger brugeren på tværs af enheder.
// Regler: ved login vinder kontoens gemte værdier over lokal cache
// (localStorage er kun hurtig første-maling); efterfølgende ændringer
// skrives tilbage med debounce.

const THEMES = ['system', 'light', 'dark'] as const
const NAV_MODES = ['classic', 'modern'] as const
const LANGUAGES = ['da', 'en'] as const

type Theme = (typeof THEMES)[number]

function prefsKey(theme: string, navMode: string, language: string) {
  return `${theme}|${navMode}|${language}`
}

export function PreferencesSync() {
  const { i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { navMode, setNavMode } = useUiSettings()
  const { session } = useSession()

  const appliedUser = useRef<string | null>(null)
  const lastSynced = useRef<string>('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const userId = session?.user.id
  const language = i18n.resolvedLanguage ?? 'da'

  // Ved login: anvend kontoens gemte valg (én gang pr. bruger).
  useEffect(() => {
    if (!userId || appliedUser.current === userId) return
    appliedUser.current = userId
    const meta = session!.user.user_metadata ?? {}

    const savedTheme = THEMES.includes(meta.theme) ? (meta.theme as Theme) : theme
    const savedNav = NAV_MODES.includes(meta.nav_mode) ? (meta.nav_mode as NavMode) : navMode
    const savedLang = LANGUAGES.includes(meta.language) ? (meta.language as string) : language

    if (savedTheme !== theme) setTheme(savedTheme)
    if (savedNav !== navMode) setNavMode(savedNav)
    if (savedLang !== language) i18n.changeLanguage(savedLang)

    // De anvendte værdier er allerede kontoens — skriv dem ikke tilbage.
    lastSynced.current = prefsKey(savedTheme, savedNav, savedLang)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Ved ændringer efter login: skriv tilbage til kontoen (debounced).
  useEffect(() => {
    if (!userId || appliedUser.current !== userId) return
    const key = prefsKey(theme, navMode, language)
    if (key === lastSynced.current) return

    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      lastSynced.current = key
      const { error } = await supabase.auth.updateUser({
        data: { theme, nav_mode: navMode, language },
      })
      if (error) console.error('Kunne ikke gemme præferencer på kontoen:', error)
    }, 800)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [userId, theme, navMode, language])

  return null
}

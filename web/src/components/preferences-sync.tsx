import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Session } from '@supabase/supabase-js'
import { THEMES, useTheme, type Theme } from '@/components/theme-provider'
import { NAV_MODES, useUiSettings, type NavMode } from '@/components/ui-settings-provider'
import { SUPPORTED_LANGUAGES } from '@/i18n'
import { supabase } from '@/lib/supabase'

// Synkroniserer UI-præferencer (tema, navigation, sprog) med kontoen via
// auth user metadata, så valgene følger brugeren på tværs af enheder.
// Regler:
//  - Ved login vinder kontoens gemte værdier over lokal cache; felter kontoen
//    ikke kender, uploades fra de lokale værdier — undtagen sprog, som først
//    synkroniseres når brugeren aktivt vælger det (browser-detektion er ikke
//    et valg og må ikke låses fast på kontoen).
//  - Der skrives kun ændrede felter (metadata-nøgler merges server-side), så
//    valg foretaget på andre enheder ikke overskrives.
//  - Et felt regnes først som synkroniseret når skrivningen er lykkedes;
//    fejlede skrivninger prøves igen.

type Prefs = { theme: Theme; nav_mode: NavMode; language: string }

const WRITE_DELAY_MS = 800
const RETRY_DELAY_MS = 5000

// Logout skal flushe udestående ændringer FØR signOut — bagefter er sessionen
// væk og updateUser afvises. Sættes af den monterede PreferencesSync.
let activeFlush: (() => Promise<void>) | null = null
export function flushPreferences(): Promise<void> {
  return activeFlush?.() ?? Promise.resolve()
}

export function PreferencesSync({ session }: { session: Session }) {
  const { i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { navMode, setNavMode } = useUiSettings()

  const userId = session.user.id
  const language = i18n.resolvedLanguage ?? 'da'

  const appliedUser = useRef<string | null>(null)
  // Kontoens senest kendte værdier — kun felter kontoen faktisk har.
  const account = useRef<Partial<Prefs>>({})
  // Værdierne apply-effekten sigter mod: writeren er død indtil lokal state
  // har indhentet dem, så første commit efter login (hvor lokal state stadig
  // er den gamle cache) aldrig når at skrive noget tilbage.
  const applyTarget = useRef<Prefs | null>(null)
  const armed = useRef(false)
  // Sproget ved login: kun en afvigelse herfra er et aktivt brugervalg.
  const loginLanguage = useRef('')
  const current = useRef<Prefs>({ theme, nav_mode: navMode, language })
  current.current = { theme, nav_mode: navMode, language }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushing = useRef(false)
  const disposed = useRef(false)

  function pendingWrites(): Partial<Prefs> | null {
    if (!armed.current) return null
    const acc = account.current
    const cur = current.current
    const data: Partial<Prefs> = {}
    if (cur.theme !== acc.theme) data.theme = cur.theme
    if (cur.nav_mode !== acc.nav_mode) data.nav_mode = cur.nav_mode
    const languageChosen =
      acc.language !== undefined || cur.language !== loginLanguage.current
    if (languageChosen && cur.language !== acc.language) data.language = cur.language
    return Object.keys(data).length ? data : null
  }

  async function flush() {
    if (flushing.current) return
    const data = pendingWrites()
    if (!data) return
    flushing.current = true
    try {
      const { error } = await supabase.auth.updateUser({ data })
      if (error) throw error
      Object.assign(account.current, data)
    } catch (error) {
      console.error('Kunne ikke gemme præferencer på kontoen:', error)
      // Felterne er stadig usynkroniserede — prøv igen senere.
      if (!disposed.current) {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => void flush(), RETRY_DELAY_MS)
      }
    } finally {
      flushing.current = false
    }
  }

  // Ved login: anvend kontoens gemte valg (én gang pr. bruger).
  useEffect(() => {
    if (appliedUser.current === userId) return
    appliedUser.current = userId
    armed.current = false
    const meta = session.user.user_metadata ?? {}

    const acc: Partial<Prefs> = {}
    if (THEMES.includes(meta.theme)) acc.theme = meta.theme as Theme
    if (NAV_MODES.includes(meta.nav_mode)) acc.nav_mode = meta.nav_mode as NavMode
    if (SUPPORTED_LANGUAGES.includes(meta.language)) acc.language = meta.language as string
    account.current = acc
    loginLanguage.current = language

    const target: Prefs = {
      theme: acc.theme ?? theme,
      nav_mode: acc.nav_mode ?? navMode,
      language: acc.language ?? language,
    }
    applyTarget.current = target
    if (target.theme !== theme) setTheme(target.theme)
    if (target.nav_mode !== navMode) setNavMode(target.nav_mode)
    if (target.language !== language) i18n.changeLanguage(target.language)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Ved ændringer efter login: skriv de ændrede felter tilbage (debounced).
  useEffect(() => {
    if (appliedUser.current !== userId) return
    if (!armed.current) {
      const t = applyTarget.current
      if (!t || theme !== t.theme || navMode !== t.nav_mode || language !== t.language) return
      armed.current = true
    }
    if (!pendingWrites()) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), WRITE_DELAY_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, theme, navMode, language])

  // Flush når fanen skjules (bedste chance for at nå serveren inden luk) og
  // ved unmount; eksponer flush til logout-flowet via flushPreferences().
  useEffect(() => {
    disposed.current = false
    activeFlush = flush
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (activeFlush === flush) activeFlush = null
      disposed.current = true
      if (timer.current) clearTimeout(timer.current)
      void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

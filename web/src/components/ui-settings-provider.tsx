import { createContext, useContext, useState } from 'react'

// Navigationstilstand: 'classic' = klassisk sidemenu med al funktionalitet
// synlig; 'modern' = navigation samlet i dropdown-menu nederst til venstre
// (som compliance-circle/gorm.ai). localStorage er lokal cache til hurtig
// første-maling; kontoens gemte valg anvendes ved login (PreferencesSync).

export const NAV_MODES = ['classic', 'modern'] as const
export type NavMode = (typeof NAV_MODES)[number]

type UiSettingsContextValue = {
  navMode: NavMode
  setNavMode: (mode: NavMode) => void
  // Minimeret sidemenu (begge navigationstilstande). Bevidst KUN lokal: det er
  // et vindues-/skærmvalg, ikke en kontopræference som tema og navigationsform,
  // så det følger ikke brugeren til andre enheder (jf. PreferencesSync).
  navCollapsed: boolean
  setNavCollapsed: (collapsed: boolean) => void
  toggleNavCollapsed: () => void
}

const STORAGE_KEY = 'operia-nav-mode'
const COLLAPSED_KEY = 'operia-nav-collapsed'

const UiSettingsContext = createContext<UiSettingsContextValue | null>(null)

export function UiSettingsProvider({ children }: { children: React.ReactNode }) {
  const [navMode, setNavModeState] = useState<NavMode>(
    () => (localStorage.getItem(STORAGE_KEY) as NavMode) ?? 'modern',
  )
  const [navCollapsed, setNavCollapsedState] = useState<boolean>(
    () => localStorage.getItem(COLLAPSED_KEY) === '1',
  )

  const setNavMode = (mode: NavMode) => {
    localStorage.setItem(STORAGE_KEY, mode)
    setNavModeState(mode)
  }

  const setNavCollapsed = (collapsed: boolean) => {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0')
    setNavCollapsedState(collapsed)
  }

  return (
    <UiSettingsContext.Provider
      value={{
        navMode,
        setNavMode,
        navCollapsed,
        setNavCollapsed,
        toggleNavCollapsed: () => setNavCollapsed(!navCollapsed),
      }}
    >
      {children}
    </UiSettingsContext.Provider>
  )
}

export function useUiSettings() {
  const ctx = useContext(UiSettingsContext)
  if (!ctx) throw new Error('useUiSettings skal bruges inden i <UiSettingsProvider>')
  return ctx
}

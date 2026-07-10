import { createContext, useContext, useState } from 'react'

// Navigationstilstand: 'classic' = klassisk sidemenu med al funktionalitet
// synlig; 'modern' = navigation samlet i dropdown-menu nederst til venstre
// (som compliance-circle/gorm.ai). Brugervalg — gemmes lokalt indtil en
// per-bruger-indstilling lander i databasen.

export type NavMode = 'classic' | 'modern'

type UiSettingsContextValue = {
  navMode: NavMode
  setNavMode: (mode: NavMode) => void
}

const STORAGE_KEY = 'operia-nav-mode'

const UiSettingsContext = createContext<UiSettingsContextValue | null>(null)

export function UiSettingsProvider({ children }: { children: React.ReactNode }) {
  const [navMode, setNavModeState] = useState<NavMode>(
    () => (localStorage.getItem(STORAGE_KEY) as NavMode) ?? 'modern',
  )

  const setNavMode = (mode: NavMode) => {
    localStorage.setItem(STORAGE_KEY, mode)
    setNavModeState(mode)
  }

  return (
    <UiSettingsContext.Provider value={{ navMode, setNavMode }}>
      {children}
    </UiSettingsContext.Provider>
  )
}

export function useUiSettings() {
  const ctx = useContext(UiSettingsContext)
  if (!ctx) throw new Error('useUiSettings skal bruges inden i <UiSettingsProvider>')
  return ctx
}

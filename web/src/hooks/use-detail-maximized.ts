import { useSyncExternalStore } from 'react'

// Delt "maksimeret detaljepanel"-tilstand (gorm.ai-mønsteret): DetailTabs
// viser knappen, og siderne skjuler deres tabel når panelet er maksimeret.
// Et lille modul-globalt store i stedet for context, så begge kan læse samme
// værdi uden prop-føring gennem otte sider. Valget huskes i localStorage og
// gælder på tværs af alle detaljepaneler.
const KEY = 'operia-detail-maximized'

// localStorage kan være blokeret (Safari "Bloker alle cookies", indlejrede
// webviews) — så gælder valget kun for sessionen i stedet for at vælte hele
// rutens modul-evaluering.
function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

let maximized = readStored()
const listeners = new Set<() => void>()

function setMaximized(next: boolean) {
  maximized = next
  try {
    localStorage.setItem(KEY, String(next))
  } catch {
    // Ingen persistens uden storage-adgang.
  }
  listeners.forEach((notify) => notify())
}

export function useDetailMaximized() {
  const value = useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
    () => maximized,
  )
  const toggle = () => setMaximized(!maximized)
  return [value, toggle] as const
}

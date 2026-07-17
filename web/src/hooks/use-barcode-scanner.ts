import { useEffect, useRef } from 'react'

// Keyboard-wedge stregkodescanner (fx Datalogic QuickScan QD2430). En HID-scanner
// "skriver" stregkoden som tastetryk i hurtig rækkefølge og afslutter med Enter.
// Vi kan derfor ikke skelne den fra tastaturet på hardware-niveau — i stedet måler
// vi tempoet: kommer tegnene hurtigere end et menneske kan taste (< intervalgrænsen)
// og afsluttes med Enter, behandler vi det som en scanning.
//
// Fordelen frem for bare at lytte på Enter i selve feltet: scanningen fanges
// globalt, så en håndterer kan scanne uden først at klikke i stregkodefeltet.
//
// Står markøren i et ANDET skrivefelt (note, modtager m.m.), kan vi ikke stoppe
// de enkelte tegn — de er allerede i feltet når serien afsløres som en scanning.
// Derfor ryddes der op bagudrettet: scanner-Enteren opsnappes (så den ikke
// indsender formularen med et halvfærdigt indhold), stregkoden fjernes fra
// feltet igen, og scanningen leveres som var den sket uden fokus i feltet.

type Options = {
  onScan: (code: string) => void
  enabled?: boolean
  // Mindste længde før en tegnserie regnes som en stregkode (afviser fx et
  // enkelt Enter-tryk).
  minLength?: number
  // Største tid (ms) mellem to tastetryk for stadig at være "scanner-hurtigt".
  // Et større hul starter en ny serie. ~50ms ≈ 20 tegn/sek, hurtigere end
  // manuel tastning, men rigeligt til selv langsomme scannere.
  maxKeyIntervalMs?: number
  // Feltet der lovligt modtager scanningen — dér skal der ikke ryddes op.
  targetRef?: React.RefObject<HTMLElement | null>
}

function isEditable(node: EventTarget | null): boolean {
  const el = node as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

// Fjern stregkoden fra det felt scanneren nåede at "taste" den ind i. Værdien
// sættes via prototypens setter og der affyres et input-event, så Reacts
// kontrollerede felter opdager ændringen. Står stregkoden ikke sidst i feltet
// (markør midt i teksten), røres værdien ikke — hellere et tegn for meget i en
// note end at slette brugerens egen tekst.
function stripScannedSuffix(el: Element, code: string) {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return
  const value = el.value
  if (!value.endsWith(code)) return
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value.slice(0, value.length - code.length))
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export function useBarcodeScanner({
  onScan,
  enabled = true,
  minLength = 3,
  maxKeyIntervalMs = 50,
  targetRef,
}: Options) {
  const buffer = useRef('')
  const lastTime = useRef(0)
  // Hold callbacken frisk uden at gentilmelde lytteren ved hver render.
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      // Genvejskombinationer er aldrig en scanning.
      if (e.ctrlKey || e.altKey || e.metaKey) return

      const now = e.timeStamp || performance.now()
      const gap = now - lastTime.current
      lastTime.current = now

      if (e.key === 'Enter') {
        const code = buffer.current
        buffer.current = ''
        // Enteren skal følge serien i scanner-tempo — en manuel Enter længe
        // efter sidste tegn er brugerens egen (fx indsend formular).
        if (code.length >= minLength && gap <= maxKeyIntervalMs) {
          // Fang Enter, så feltets egen Enter-håndtering ikke også udløser
          // handlingen (dobbelt opslag / utilsigtet indsendelse).
          e.preventDefault()
          e.stopPropagation()
          const target = targetRef?.current ?? null
          const active = document.activeElement
          if (active && isEditable(active) && active !== target) {
            stripScannedSuffix(active, code)
          }
          onScanRef.current(code)
        }
        return
      }

      // Kun enkelttegn indgår i en stregkode (Shift, piletaster osv. har
      // key-navne længere end ét tegn).
      if (e.key.length !== 1) return

      // For stort hul → ny serie (fx menneske der taster langsomt, eller
      // første tegn efter en pause).
      buffer.current = gap > maxKeyIntervalMs ? e.key : buffer.current + e.key
    }

    document.addEventListener('keydown', handler, { capture: true })
    return () => document.removeEventListener('keydown', handler, { capture: true })
  }, [enabled, minLength, maxKeyIntervalMs, targetRef])
}

import { useEffect, useRef } from 'react'

// Keyboard-wedge stregkodescanner (fx Datalogic QuickScan QD2430). En HID-scanner
// "skriver" stregkoden som tastetryk i hurtig rækkefølge. Vi kan derfor ikke
// skelne den fra tastaturet på hardware-niveau — i stedet måler vi tempoet:
// kommer tegnene hurtigere end et menneske kan taste (< intervalgrænsen), er det
// en scanning. Serien afsluttes af scannerens Enter/Tab-suffiks — eller, for
// scannere uden suffiks, af en kort pause efter serien (idle-flush).
//
// Fordelen frem for bare at lytte på Enter i selve feltet: scanningen fanges
// globalt, så en håndterer kan scanne uden først at klikke i stregkodefeltet.
//
// TASTATURLAYOUT: scannere sender amerikanske HID-tastekoder (fabriksstandard),
// men OS'et oversætter dem efter det AKTIVE layout — på dansk bliver ':' til 'Æ',
// '/' til '-' og '-' til '+'. Derfor afkodes serien fra den FYSISKE tast
// (KeyboardEvent.code) gennem US-layoutet i stedet for e.key, så scanninger er
// uafhængige af OS'ets tastaturlayout. Tegn uden US-afkodning (eksotiske taster)
// falder tilbage til e.key. Bemærk: en scanner der er OMKONFIGURERET til dansk
// tastaturland vil så blive fejlafkodet — lad scanneren stå på US (standard).
//
// Står markøren i et ANDET skrivefelt (note, modtager m.m.), kan vi ikke stoppe
// de enkelte tegn — de er allerede i feltet når serien afsløres som en scanning.
// Derfor ryddes der op bagudrettet: scanner-suffikset opsnappes (så det ikke
// indsender formularen med et halvfærdigt indhold), stregkoden fjernes fra
// feltet igen, og scanningen leveres som var den sket uden fokus i feltet.
// Idle-flush leverer ALDRIG fra et fremmed skrivefelt — uden suffiks kan vi ikke
// vide om det var en scanning eller brugerens egen hurtige tastning.

// Scannere kan være sat op til at sende et AIM-symbologi-id foran koden
// (]Q1 = QR-kode, ]C1 = Code 128, ]d2 = DataMatrix, ]E0 = EAN …). Det er
// metadata om kodetypen — ikke indhold — og fjernes altid, så QR og stregkode
// med samme værdi gemmes og slås op som samme kode.
//
// Normaliseringen gælder ALLE indgange til en stregkode — scanning, manuel
// indtastning og indsætning — på både web og håndterminal (samme rækkefølge
// som Components.kt: trim → strip → trim), så gem og opslag altid mødes.
const AIM_PREFIX = /^\][A-Za-z]\d/

export function normalizeScan(raw: string): string {
  return raw.trim().replace(AIM_PREFIX, '').trim()
}

// US-layout: fysisk tast (KeyboardEvent.code) → [uden shift, med shift].
const US_LAYOUT: Record<string, [string, string]> = {
  Digit1: ['1', '!'],
  Digit2: ['2', '@'],
  Digit3: ['3', '#'],
  Digit4: ['4', '$'],
  Digit5: ['5', '%'],
  Digit6: ['6', '^'],
  Digit7: ['7', '&'],
  Digit8: ['8', '*'],
  Digit9: ['9', '('],
  Digit0: ['0', ')'],
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Backslash: ['\\', '|'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Backquote: ['`', '~'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
  Space: [' ', ' '],
  NumpadDecimal: ['.', '.'],
  NumpadSubtract: ['-', '-'],
  NumpadAdd: ['+', '+'],
  NumpadMultiply: ['*', '*'],
  NumpadDivide: ['/', '/'],
}
for (let i = 0; i < 26; i++) {
  const lower = String.fromCharCode(97 + i)
  US_LAYOUT[`Key${lower.toUpperCase()}`] = [lower, lower.toUpperCase()]
}
for (let d = 0; d <= 9; d++) US_LAYOUT[`Numpad${d}`] = [String(d), String(d)]

// Hvad scanneren MENTE at taste: fysisk tast gennem US-layoutet (CapsLock og
// OS-layout uden betydning). Ukendte taster falder tilbage til det tegn OS'et
// selv producerede.
function decodeKey(e: KeyboardEvent): string {
  const mapped = US_LAYOUT[e.code]
  if (mapped) return e.shiftKey ? mapped[1] : mapped[0]
  return e.key.length === 1 ? e.key : ''
}

type Options = {
  onScan: (code: string) => void
  enabled?: boolean
  // Mindste længde før en tegnserie regnes som en stregkode (afviser fx et
  // enkelt Enter-tryk).
  minLength?: number
  // Største tid (ms) mellem to tastetryk for stadig at være "scanner-hurtigt".
  // Et større hul starter en ny serie. ~80ms ≈ 12 tegn/sek — hurtigere end
  // vedvarende manuel tastning, men rummeligt nok til langsomme (fx Bluetooth-)
  // scannere.
  maxKeyIntervalMs?: number
  // Pause (ms) efter sidste tegn, hvorefter en suffiks-løs serie leveres som
  // scanning.
  idleFlushMs?: number
  // Mindste længde før idle-flush (uden suffiks) tør levere serien. Uden
  // suffiks er der ingen scanner-markør at kende serien på, så kravet er
  // strengere end minLength: en hurtig menneskelig tastesalve på 3-5 tegn må
  // ikke blive en fantomscanning. Rigtige koder er 8+ tegn (OPR-/OPB- er 12,
  // EAN-8 er 8).
  idleFlushMinLength?: number
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
  maxKeyIntervalMs = 80,
  idleFlushMs = 250,
  idleFlushMinLength = 8,
  targetRef,
}: Options) {
  // To sideløbende buffere for samme serie: 'raw' er hvad OS'et faktisk skrev
  // (bruges til at rydde op i fremmede felter), 'decoded' er den layout-
  // uafhængige US-afkodning (det der leveres som scanning).
  const raw = useRef('')
  const decoded = useRef('')
  const lastTime = useRef(0)
  const flushTimer = useRef<number | undefined>(undefined)
  // Hold callbacken frisk uden at gentilmelde lytteren ved hver render.
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!enabled) return

    const clearFlush = () => {
      if (flushTimer.current !== undefined) {
        clearTimeout(flushTimer.current)
        flushTimer.current = undefined
      }
    }
    const resetBuffer = () => {
      raw.current = ''
      decoded.current = ''
    }
    const deliver = () => {
      const normalized = normalizeScan(decoded.current || raw.current)
      resetBuffer()
      if (normalized) onScanRef.current(normalized)
    }

    const handler = (e: KeyboardEvent) => {
      // Genvejskombinationer er aldrig en scanning.
      if (e.ctrlKey || e.altKey || e.metaKey) return

      // Auto-repeat (holdt tast) kommer aldrig fra en scanner — den sender
      // enkelttryk. En holdt tast er altså et menneske: glem serien, så den
      // hverken idle-flusher eller forlænges af repeats.
      if (e.repeat) {
        clearFlush()
        resetBuffer()
        return
      }

      const now = e.timeStamp || performance.now()
      const gap = now - lastTime.current
      lastTime.current = now

      // Scanner-suffiks (Enter eller Tab) afslutter serien.
      if (e.key === 'Enter' || e.key === 'Tab') {
        clearFlush()
        const rawCode = raw.current
        const isScan =
          Math.max(rawCode.length, decoded.current.length) >= minLength &&
          gap <= maxKeyIntervalMs
        if (!isScan) {
          // Brugerens egen Enter/Tab (fx indsend formular, feltskift) — lad den
          // passere, men glem serien så den ikke idle-flusher senere.
          resetBuffer()
          return
        }
        // Fang suffikset, så feltets egen Enter/Tab-håndtering ikke også
        // udløser en handling (dobbelt opslag / utilsigtet indsendelse).
        e.preventDefault()
        e.stopPropagation()
        const target = targetRef?.current ?? null
        const active = document.activeElement
        if (active && isEditable(active) && active !== target) {
          // Oprydning i feltet sker med den rå serie — det var den, der blev "tastet".
          stripScannedSuffix(active, rawCode)
        }
        deliver()
        return
      }

      const decodedChar = decodeKey(e)
      const rawChar = e.key.length === 1 ? e.key : ''
      // Hverken tegn eller afkodning (Shift, piletaster osv.) → ikke en del af
      // serien. Døde taster (fx dansk ¨) HAR en US-afkodning og tælles med.
      if (!decodedChar && !rawChar) return

      // For stort hul → ny serie (fx menneske der taster langsomt, eller
      // første tegn efter en pause).
      if (gap > maxKeyIntervalMs) resetBuffer()
      raw.current += rawChar
      decoded.current += decodedChar

      // Scannere uden suffiks: leverer serien efter en kort pause. Kun når
      // fokus er på målfeltet eller uden for skrivefelter — fra et fremmed
      // felt kan en suffiks-løs serie lige så godt være brugerens egen tastning.
      // Længdekravet er det strenge (idleFlushMinLength): uden suffiks skal en
      // kort, hurtig tastesalve ikke kunne blive en fantomscanning.
      clearFlush()
      if (Math.max(raw.current.length, decoded.current.length) >= idleFlushMinLength) {
        flushTimer.current = window.setTimeout(() => {
          flushTimer.current = undefined
          const target = targetRef?.current ?? null
          const active = document.activeElement
          if (active && isEditable(active) && active !== target) {
            resetBuffer()
            return
          }
          deliver()
        }, idleFlushMs)
      }
    }

    document.addEventListener('keydown', handler, { capture: true })
    return () => {
      clearFlush()
      document.removeEventListener('keydown', handler, { capture: true })
    }
  }, [enabled, minLength, maxKeyIntervalMs, idleFlushMs, idleFlushMinLength, targetRef])
}

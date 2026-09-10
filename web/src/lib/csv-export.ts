// CSV-eksport, der spejler importens filformat (Import → Konfiguration):
// samme separator, header/footer og felt-rækkefølge. En eksport → re-import
// er derfor tabsfri: kolonneoverskrifterne er feltnøglerne, som importens
// aliasser matcher, og teksten er UTF-8 (BOM så Excel læser æ/ø/å korrekt).

export type CsvFormat = {
  hasHeader: boolean
  hasFooter: boolean
  separator: string
  fields: string[]
}

export type CsvRecord = Record<string, string | number | null | undefined>

// Formel-injektion: Excel/LibreOffice udfører en celle, der begynder med
// = + - @ (og tabulator/CR), som en formel — også når den står i anførselstegn
// efter RFC 4180. En booking-titel eller et medarbejdernavn skrevet af en
// bruger med færre rettigheder må ikke blive til en HYPERLINK/DDE-formel på
// managerens maskine. Cellen får derfor en apostrof foran, som regnearket viser
// som tekst. Undtagelsen er tal og telefonnumre ('-5', '+45 12 34 56 78'):
// de består kun af cifre, mellemrum og tegnsætning, kan ikke være formler, og
// skal kunne re-importeres uændret (Import → Konfiguration læser samme format).
const FORMULA_LEAD = /^[=@\t\r]/
const SIGNED_NUMBER = /^[+-][\d\s().,\-]*$/
function neutralizeFormula(s: string): string {
  if (s === '') return s
  if (FORMULA_LEAD.test(s)) return `'${s}`
  if ((s[0] === '+' || s[0] === '-') && !SIGNED_NUMBER.test(s)) return `'${s}`
  return s
}

// Citér en celle når den indeholder separator, citationstegn eller linjeskift
// (RFC 4180), efter formel-neutralisering. Ellers skrives den råt. Delt med
// rapportrenderen (reports/report-render.ts), så der kun er ÉT sted at holde
// reglerne.
export function escapeCsvCell(value: string | number | null | undefined, sep: string): string {
  const s = value == null ? '' : typeof value === 'number' ? String(value) : neutralizeFormula(String(value))
  if (s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
const escapeCell = escapeCsvCell

// Byg CSV-teksten. `fields` er de aktive felter i rækkefølge; `headerFor`
// giver kolonneoverskriften for et felt (typisk feltnøglen, så importen kan
// genkende den via sine aliasser).
export function buildCsv(
  format: CsvFormat,
  headerFor: (field: string) => string,
  records: CsvRecord[],
): string {
  const sep = format.separator || ','
  const { fields } = format
  const lines: string[] = []
  if (format.hasHeader) {
    lines.push(fields.map((f) => escapeCell(headerFor(f), sep)).join(sep))
  }
  for (const rec of records) {
    lines.push(fields.map((f) => escapeCell(rec[f], sep)).join(sep))
  }
  // Footeren droppes ved import (sidste linje) — vi skriver en simpel
  // optællings-trailer, så et hasFooter-format round-tripper.
  if (format.hasFooter) {
    lines.push(escapeCell(`# ${records.length}`, sep))
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

// Trigger en browser-download af CSV-teksten.
export function downloadCsv(fileName: string, csv: string): void {
  downloadBlob(fileName, new Blob([csv], { type: 'text/csv;charset=utf-8' }))
}

// Trigger en browser-download af en vilkårlig blob (CSV, ZIP, …).
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// YYYY-MM-DD til filnavnet.
export function dateStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

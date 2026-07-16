// Afvisningsårsager for imports gemmes SPROGUAFHÆNGIGT som koder (+ evt.
// parametre) i import_runs.errors, og oversættes her ved visning — så en
// afvist SFTP-/e-mail-import (skrevet server-side) vises i fremviserens sprog.
// Ældre rækker (og klient-importer) kan gemme fri tekst i `reason`; den vises
// uændret som fallback.

export type ImportError = {
  row: number
  code?: string
  params?: Record<string, string | number>
  reason?: string // legacy/fri tekst
}

type TFn = (key: string, opts?: Record<string, unknown>) => string

// code → i18n-nøgle under importReasons.*
const REASON_KEYS: Record<string, string> = {
  encoding: 'importReasons.encoding',
  parse: 'importReasons.parse',
  empty: 'importReasons.empty',
  missingName: 'importReasons.missingName',
  missingEmployeeNo: 'importReasons.missingEmployeeNo',
  duplicateEmployeeNo: 'importReasons.duplicateEmployeeNo',
  separatorMismatch: 'importReasons.separatorMismatch', // params: sep, found
  missingColumns: 'importReasons.missingColumns', // params: cols (komma-adskilte feltnøgler)
  senderNotAllowed: 'importReasons.senderNotAllowed',
  noCsvAttachment: 'importReasons.noCsvAttachment',
  allowlistRequired: 'importReasons.allowlistRequired',
  badAttachment: 'importReasons.badAttachment',
  exception: 'importReasons.exception', // params: message
  tooManyDeactivations: 'importReasons.tooManyDeactivations', // params: count, active
  importBusy: 'importReasons.importBusy',
}

// En separator vises som "tab" i stedet for et usynligt tabulatortegn.
function sepLabel(v: unknown, t: TFn): string {
  return v === '\t' ? t('importPage.tabSeparator') : String(v ?? '')
}

export function reasonText(err: ImportError | null | undefined, t: TFn): string {
  if (!err) return ''
  const key = err.code ? REASON_KEYS[err.code] : undefined
  if (key) {
    const p: Record<string, unknown> = { ...(err.params ?? {}) }
    if ('sep' in p) p.sep = sepLabel(p.sep, t)
    if ('found' in p) p.found = sepLabel(p.found, t)
    // Manglende kolonner gemmes som feltnøgler → oversæt hver til dens label.
    if (typeof p.cols === 'string') {
      p.cols = p.cols
        .split(',')
        .filter(Boolean)
        .map((k) => t(`importConfig.field_${k}`))
        .join(', ')
    }
    return t(key, p)
  }
  return err.reason ?? ''
}

// Parse import_runs.errors (jsonb) sikkert til ImportError[].
export function parseErrors(raw: unknown): ImportError[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((e): e is ImportError => !!e && typeof e === 'object')
}

// Sammenfattet, oversat årsagstekst til en afvist/fejlet kørsel: første årsag
// plus "(+N)" hvis der er flere.
export function summarizeReasons(raw: unknown, t: TFn): string {
  const errs = parseErrors(raw)
  if (errs.length === 0) return ''
  const first = reasonText(errs[0], t)
  return errs.length > 1 ? `${first} (+${errs.length - 1})` : first
}

// Stregkode-værn (klientspejl af assets_barcode_sane/parcels_barcode_sane):
// tegnsættet er frit — en stregkode er en opak identifikator (Code 128 og QR
// er alfanumeriske, systemets egne koder ligeså) — men længde og kontroltegn
// har hårde grænser, og URL-lignende koder advares der om (warn-and-allow:
// en leverandørs QR-label må gerne adopteres bevidst; en fejlscanning af en
// tilfældig QR skal fanges).

export const BARCODE_MAX_LENGTH = 128

export type BarcodeProblem = 'too_long' | 'control_chars' | null

export function barcodeProblem(code: string): BarcodeProblem {
  if (code.length > BARCODE_MAX_LENGTH) return 'too_long'
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(code)) return 'control_chars'
  return null
}

export const barcodeProblemKey: Record<Exclude<BarcodeProblem, null>, string> = {
  too_long: 'assetsPage.barcodeTooLong',
  control_chars: 'assetsPage.barcodeControlChars',
}

// "Ligner en webadresse" — bevidst løs: fanger det typiske QR-indhold
// (https://…, www.…), ikke alt der teoretisk kunne være en URI.
export function looksLikeUrl(code: string): boolean {
  return /^(https?:\/\/|www\.)/i.test(code.trim())
}

// Kan modtageren overhovedet nås på en given kanal? Spejler dispatcherens
// regler: e-mail sendes som den står (Resend afviser ugyldige), SMS normaliseres
// med toMsisdn i supabase/functions/_shared/send-sms.ts — 8 cifre antages dansk,
// ellers kræves landekode (9–15 cifre i alt). Hold i sync med den.

export function hasValidEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const e = email.trim()
  return e.includes('@') && !e.startsWith('@') && !e.endsWith('@')
}

export function hasValidMsisdn(phone: string | null | undefined): boolean {
  if (!phone) return false
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 8) return true // bart dansk nummer — får 45 foran
  return digits.length >= 9 && digits.length <= 15
}

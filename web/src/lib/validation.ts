// Feltvalidering der bruges flere steder. Holdes bevidst løs: formålet er at
// fange tastefejl (manglende @, manglende domæne) — ikke at afgøre om en
// adresse findes. Den afgørelse hører til hos den der sender mailen.
//
// Komma og semikolon er dog ALDRIG gyldige i én adresse (typisk et indsat
// "liste"-input, fx "a@b.dk,"). De udelukkes eksplicit, ellers slipper de
// gennem [^\s@] og bliver først afvist ved afsendelse (Resend 422).
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

// Feltvalidering der bruges flere steder. Holdes bevidst løs: formålet er at
// fange tastefejl (manglende @, manglende domæne) — ikke at afgøre om en
// adresse findes. Den afgørelse hører til hos den der sender mailen.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

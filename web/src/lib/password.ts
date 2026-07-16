// Stærk tilfældig adgangskode (kryptografisk RNG). Mindst ét tegn fra hvert sæt,
// resten tilfældigt, derefter blandet (Fisher–Yates). Delt af bruger-invitation
// og SFTP-credentials.
export function generateStrongPassword(length = 16): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%^&*-_=+']
  const all = sets.join('')
  const rnd = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n
  const pick = (chars: string) => chars[rnd(chars.length)]
  const out = sets.map(pick)
  while (out.length < length) out.push(pick(all))
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}

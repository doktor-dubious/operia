// Fælles vagt for webhook-endpoints deployet med --no-verify-jwt (SFTPGo- og
// Postmark-hooks). Hemmeligheden accepteres i prioriteret rækkefølge:
//   1. X-Operia-Hook-Secret-header  (foretrukket — headere ender ikke i access-
//      logs/proxyer som URL'er gør; SFTPGo sender den via httpclient.headers)
//   2. HTTP Basic-auth password     (Postmark kan kun URL — https://hook:SECRET@…
//      flyttes af klienten til Authorization-headeren og logges ikke som query)
//   3. ?token=… i URL'en            (bagudkompatibel; udfases)
// Sammenligningen er konstant-tid, så tokenet ikke kan gættes via timing.
import { timingSafeEqual } from 'jsr:@std/crypto@1/timing-safe-equal'

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.byteLength !== bb.byteLength) return false
  return timingSafeEqual(ab, bb)
}

export function hookAuthorized(req: Request, secretEnvName: string): boolean {
  const secret = Deno.env.get(secretEnvName)
  if (!secret) return false // fail closed: uden konfigureret hemmelighed afvises alt

  const header = req.headers.get('x-operia-hook-secret')
  if (header) return safeEqual(header, secret)

  const auth = req.headers.get('authorization')
  if (auth?.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = atob(auth.slice(6).trim())
      const pass = decoded.slice(decoded.indexOf(':') + 1)
      if (pass) return safeEqual(pass, secret)
    } catch {
      return false
    }
  }

  const token = new URL(req.url).searchParams.get('token')
  return token != null && safeEqual(token, secret)
}

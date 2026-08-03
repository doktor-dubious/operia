import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandLogo } from '@/components/brand-logo'
import { supabase } from '@/lib/supabase'
import type { AuthError } from '@supabase/supabase-js'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

/** Udvidelse af håndterminalens LoginError (AppViewModel.kt): samme tre
 *  grundslags plus GoTrues øvrige afvisninger, som skal skelnes fra en
 *  serverfejl — både i beskeden og i revisionsloggen. */
type LoginError = 'credentials' | 'network' | 'rateLimit' | 'rejected' | 'other'

const ERROR_MESSAGE: Record<LoginError, string> = {
  credentials: 'auth.signInError',
  network: 'auth.signInNetworkError',
  rateLimit: 'auth.signInRateLimitError',
  rejected: 'auth.signInRejectedError',
  other: 'auth.signInOtherError',
}

/** Kun en ægte afvisning af brugerens legitimationsoplysninger må vise
 *  "kontrollér e-mail og adgangskode". Revisionsloggen skal derimod have ALLE
 *  afviste forsøg (forkert kode, rate-limit, spærret bruger …) — netop et
 *  bruteforce-angreb, der udløser GoTrues rate-limit, må ikke forsvinde fra
 *  det append-only spor. Kun når intet svar kom (netværk) eller serveren selv
 *  fejlede (5xx), ved vi ikke om et forsøg blev afvist, og loggen er immutabel,
 *  så falske poster kan aldrig ryddes op bagefter. */
function classifyAuthError(err: AuthError): LoginError {
  // auth-js sætter status 0 når der aldrig kom et svar (offline, DNS, CORS,
  // timeout) — se AuthRetryableFetchError i lib/fetch.js. En 5xx beholder sin
  // rigtige status og falder derfor igennem til 'other' ("serverfejl"), hvilket
  // er mere retvisende end at bede brugeren tjekke sit netværk.
  if (!err.status) return 'network'
  // GoTrue svarede. Ældre gateways udelader error_code — fald tilbage på teksten
  // (samme fallback som håndterminalen).
  if (
    err.code === 'invalid_credentials' ||
    /invalid login credentials/i.test(err.message)
  ) {
    // GoTrue returnerer samme fejl for forkert kode og ukendt email; server-
    // funktionen logger begge.
    return 'credentials'
  }
  if (err.status === 429 || err.code === 'over_request_rate_limit') return 'rateLimit'
  // Øvrige 4xx (user_banned, email_not_confirmed …): et definitivt afvist
  // forsøg — bare ikke på selve koden.
  if (err.status < 500) return 'rejected'
  return 'other'
}

/** Afviste forsøg (i modsætning til udfald, hvor intet svar/afgørelse kom)
 *  skrives i revisionsloggen. */
const AUDITED_ERRORS: ReadonlySet<LoginError> = new Set(['credentials', 'rateLimit', 'rejected'])

function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<LoginError | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    // Login-audit er klient-drevet, da GoTrue-hook'en ikke er tilgængelig på
    // planen. Fire-and-forget: en fejl her må aldrig påvirke login-UX. Typerne
    // kendes først efter gen:types, så kaldet castes.
    const logAudit = (fn: string, args: Record<string, unknown>) =>
      void Promise.resolve(
        (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<unknown>)(
          fn,
          args,
        ),
      ).catch(() => {})
    if (signInError) {
      const kind = classifyAuthError(signInError)
      // Rapportér forsøget så fejlede logins (også på en ukendt email) logges —
      // men kun når GoTrue faktisk afviste forsøget (ikke netværk/serverfejl).
      if (AUDITED_ERRORS.has(kind)) logAudit('log_failed_login_attempt', { p_email: email })
      setError(kind)
      return
    }
    // Log det vellykkede login (som den netop indloggede bruger).
    logAudit('log_login_success', {})
    navigate({ to: '/' })
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <BrandLogo className="h-6 w-6" />
            {t('app.name')}
          </CardTitle>
          <CardDescription>{t('app.tagline')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t('auth.password')}</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {t('auth.forgotPassword')}
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{t(ERROR_MESSAGE[error])}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? t('common.loading') : t('auth.signIn')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Fingerprint } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandLogo } from '@/components/brand-logo'
import { supabase } from '@/lib/supabase'
import { classifyPasskeyError, passkeyErrorName } from '@/lib/passkey-errors'
import type { AuthError } from '@supabase/supabase-js'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

/** Udvidelse af håndterminalens LoginError (AppViewModel.kt): samme tre
 *  grundslags plus GoTrues øvrige afvisninger, som skal skelnes fra en
 *  serverfejl — både i beskeden og i revisionsloggen. */
type LoginError =
  | 'credentials'
  | 'network'
  | 'rateLimit'
  | 'rejected'
  | 'passkey'
  | 'passkeyOrigin'
  | 'passkeyUnsupported'
  | 'passkeyDisabled'
  | 'other'

const ERROR_MESSAGE: Record<LoginError, string> = {
  credentials: 'auth.signInError',
  network: 'auth.signInNetworkError',
  rateLimit: 'auth.signInRateLimitError',
  rejected: 'auth.signInRejectedError',
  passkey: 'auth.passkeyError',
  passkeyOrigin: 'auth.passkeyOriginError',
  passkeyUnsupported: 'auth.passkeyUnsupportedError',
  passkeyDisabled: 'auth.passkeyDisabledError',
  other: 'auth.signInOtherError',
}

/** Platformens tilladte login-metoder — anon-RPC, læses før login. */
type LoginOptions = { password_enabled: boolean; biometric_enabled: boolean }

/**
 * Har platformen eller brugerens virksomhed slået biometrisk login fra?
 *
 * Kan først afgøres EFTER ceremonien: passkeys er discoverable, så der
 * indtastes ingen email, og brugerens virksomhed er ukendt indtil sessionen
 * findes. Uden dette tjek ville et fravalg kun skjule knappen (og dét via en
 * cache, der kan være minutter gammel) — en allerede tilmeldt enhed (eller et
 * konsol-kald) kom stadig ind.
 *
 * Fejler opslaget (netværk), spærres der ikke: et udfald må ikke låse en
 * lovlig bruger ude af en metode, platformen tillader.
 */
async function biometricBlockedForCompany(userId: string): Promise<boolean> {
  // Platformens hovedafbryder gælder alle — også virksomheder uden override
  // (null = arv). Samme regel som håndterminalen (Repository.loginPolicy).
  const { data: platform } = await supabase
    .from('platform_settings')
    .select('login_biometric_enabled')
    .maybeSingle()
  if (platform?.login_biometric_enabled === false) return true
  // Filtrér på brugerens eget id: RLS-politikken viser HELE virksomheden, så
  // uden filteret fejler maybeSingle() (flere rækker), så snart virksomheden
  // har mere end én bruger — og fejlen ville tælle som "ikke spærret".
  const { data: me } = await supabase
    .from('app_users')
    .select('company_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (!me?.company_id) return false // fx platform-admin uden app_users-række
  const { data: co } = await supabase
    .from('companies')
    .select('login_biometric_enabled')
    .eq('id', me.company_id)
    .maybeSingle()
  return co?.login_biometric_enabled === false
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
  // Interpolation til fejlteksten (fx værtsnavnet ved domænefejl) og fejlens
  // tekniske navn, der vises som en dæmpet linje under beskeden. Uden det navn
  // ligner enhver passkey-fejl den samme, og årsagen må graves frem manuelt.
  const [errorParams, setErrorParams] = useState<Record<string, string>>({})
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Sæt fejl og ryd altid de to ledsagende felter, så en gammel teknisk
   *  detalje ikke hænger ved under en ny, urelateret fejl. */
  const fail = (kind: LoginError | null, detail?: string | null, params?: Record<string, string>) => {
    setError(kind)
    setErrorDetail(detail ?? null)
    setErrorParams(params ?? {})
  }

  // Hvilke metoder platformen tillader. Før svaret (eller ved fejl) vises
  // password-formularen — aldrig en tom login-side. Biometri kræver desuden
  // WebAuthn-støtte i browseren.
  const { data: loginOptions } = useQuery({
    queryKey: ['login-options'],
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc('get_login_options')
      if (rpcError) throw rpcError
      return data as LoginOptions
    },
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const biometricEnabled =
    (loginOptions?.biometric_enabled ?? false) &&
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential
  // Adgangskode-formularen er den sidste udvej: kan browseren ikke WebAuthn
  // (gammel browser, eller usikker kontekst hvor PublicKeyCredential slet ikke
  // findes), ville kortet ellers stå helt tomt — uden felt, knap eller
  // forklaring. Formularen virker stadig mod GoTrue, så den vises hellere.
  const passwordEnabled = (loginOptions?.password_enabled ?? true) || !biometricEnabled

  // Login-audit er klient-drevet, da GoTrue-hook'en ikke er tilgængelig på
  // planen. Fire-and-forget: en fejl her må aldrig påvirke login-UX.
  const logAudit = (fn: 'log_failed_login_attempt' | 'log_login_success', args: Record<string, unknown>) =>
    void Promise.resolve(
      (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<unknown>)(
        fn,
        args,
      ),
    ).catch(() => {})

  // Passkey-login (biometrisk): hele WebAuthn-ceremonien ligger i auth-js.
  // Enheden afgør selv verifikationen (fingeraftryk/ansigt/PIN) — det kan
  // hverken ses eller styres herfra. Fejlede forsøg auditeres ikke klient-
  // drevet som password-forsøg: der er ingen email at logge før ceremonien
  // lykkes, og et afbrudt/afvist forsøg når aldrig GoTrue.
  /** Oversæt en WebAuthn-fejl til besked + teknisk detalje. 'cancelled' vises
   *  ikke: brugerens eget afbrud (og "ingen passkey her" — de kan ikke skelnes,
   *  se lib/passkey-errors.ts) er ikke en fejl at råbe op om. */
  const showPasskeyError = (err: unknown) => {
    const kind = classifyPasskeyError(err)
    if (kind === 'cancelled') return
    const detail = passkeyErrorName(err)
    if (kind === 'origin') {
      // Den hyppigste årsag i praksis: siden åbnes på et andet domæne end det,
      // nøglerne er bundet til (typisk localhost under udvikling). Værtsnavnet
      // med i beskeden gør fejlen selvforklarende.
      fail('passkeyOrigin', detail, { host: window.location.host })
      return
    }
    fail(kind === 'unsupported' ? 'passkeyUnsupported' : 'passkey', detail)
  }

  const passkeySignIn = async () => {
    setBusy(true)
    fail(null)
    try {
      const { data, error: passkeyError } = await supabase.auth.signInWithPasskey()
      if (passkeyError) {
        showPasskeyError(passkeyError)
        return
      }
      if (!data?.session) {
        fail('passkey')
        return
      }
      if (await biometricBlockedForCompany(data.session.user.id)) {
        await supabase.auth.signOut()
        fail('passkeyDisabled')
        return
      }
      logAudit('log_login_success', {})
      navigate({ to: '/' })
    } catch (e) {
      showPasskeyError(e)
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    fail(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (signInError) {
      const kind = classifyAuthError(signInError)
      // Rapportér forsøget så fejlede logins (også på en ukendt email) logges —
      // men kun når GoTrue faktisk afviste forsøget (ikke netværk/serverfejl).
      if (AUDITED_ERRORS.has(kind)) logAudit('log_failed_login_attempt', { p_email: email })
      fail(kind)
      return
    }
    // Log det vellykkede login (som den netop indloggede bruger).
    logAudit('log_login_success', {})
    navigate({ to: '/' })
  }

  // Beskeden + fejlens tekniske navn. Navnet er bevidst dæmpet og på engelsk:
  // det er browserens eget (DOMException-navnet), og det er dét, en support-
  // henvendelse skal kunne citere.
  const errorNode = error && (
    <div>
      <p className="text-sm text-destructive">{t(ERROR_MESSAGE[error], errorParams)}</p>
      {errorDetail && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('auth.errorDetail', { detail: errorDetail })}
        </p>
      )}
    </div>
  )

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
          {passwordEnabled && (
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
              {errorNode}
              <Button type="submit" disabled={busy}>
                {busy ? t('common.loading') : t('auth.signIn')}
              </Button>
            </form>
          )}
          {passwordEnabled && biometricEnabled && (
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">{t('auth.orDivider')}</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          {biometricEnabled && (
            <div className="flex flex-col gap-4">
              <Button type="button" variant="outline" disabled={busy} onClick={passkeySignIn}>
                <Fingerprint className="mr-2 h-4 w-4" />
                {t('auth.signInWithPasskey')}
              </Button>
              {!passwordEnabled && errorNode}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandLogo } from '@/components/brand-logo'
import { supabase } from '@/lib/supabase'

// Glemt adgangskode: indtast e-mail → request-password-reset sender et
// nulstillingslink (via den valgte e-mail-udbyder) der lander på
// /welcome?mode=reset. Offentlig rute (uden for _app-vagten).
//
// Anti-enumerering: kvitteringen er ens uanset om kontoen findes, og
// edge-funktionens svar afslører intet.
//
// MEN en TRANSPORTfejl (kaldet nåede aldrig frem) er ikke det samme, og blev
// tidligere slugt: siden sagde "vi har sendt et link" selv om intet blev sendt.
// Om serveren kunne nås afhænger ikke af om kontoen findes, så det kan siges
// højt uden at lække noget — og uden det står brugeren og venter på en mail
// der aldrig blev bestilt.
export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setFailed(false)
    // invoke kaster ikke ved 4xx/5xx — den sætter `error`. Funktionen svarer
    // altid 200 {ok:true} for et gyldigt kald, så en fejl her betyder at kaldet
    // ikke kom frem (netværk, CORS, nedetid) — aldrig noget om kontoen.
    const { error } = await supabase.functions
      .invoke('request-password-reset', { body: { email: email.trim() } })
      .catch(() => ({ error: new Error('unreachable') }))
    setBusy(false)
    if (error) {
      setFailed(true)
      return
    }
    setSent(true)
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[28px]">
            <BrandLogo className="h-6 w-6" />
            {t('forgotPassword.title')}
          </CardTitle>
          <CardDescription>
            {sent ? t('forgotPassword.sentBody') : t('forgotPassword.subtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col gap-3">
              <Button variant="outline" className="w-full" asChild>
                <Link to="/login">{t('forgotPassword.backToLogin')}</Link>
              </Button>
              {/* Uden denne er der ingen vej tilbage til formularen: den er
                  erstattet af kvitteringen, så "prøv igen" kræver et reload. */}
              <button
                type="button"
                className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setSent(false)}
              >
                {t('forgotPassword.sendAgain')}
              </button>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={busy || !email.trim()}>
                {busy ? t('common.loading') : t('forgotPassword.submit')}
              </Button>
              {failed && (
                <p className="text-center text-sm text-destructive">
                  {t('forgotPassword.failed')}
                </p>
              )}
              <div className="text-center text-sm text-muted-foreground">
                <Link
                  to="/login"
                  className="underline-offset-4 hover:text-foreground hover:underline"
                >
                  {t('forgotPassword.backToLogin')}
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

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
// nulstillingslink (via Resend) der lander på /welcome?mode=reset. Offentlig
// rute (uden for _app-vagten). Anti-enumerering: kvitteringen er ens uanset om
// kontoen findes, og edge-funktionens svar afslører intet.
export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    // Fejl sluges: svaret må aldrig afsløre om kontoen findes.
    await supabase.functions
      .invoke('request-password-reset', { body: { email: email.trim() } })
      .catch(() => {})
    setBusy(false)
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
            <Button variant="outline" className="w-full" asChild>
              <Link to="/login">{t('forgotPassword.backToLogin')}</Link>
            </Button>
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

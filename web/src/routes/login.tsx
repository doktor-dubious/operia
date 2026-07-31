import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandLogo } from '@/components/brand-logo'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(false)
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
      // Rapportér forsøget så fejlede logins (også på en ukendt email) logges.
      logAudit('log_failed_login_attempt', { p_email: email })
      setError(true)
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
            {error && <p className="text-sm text-destructive">{t('auth.signInError')}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? t('common.loading') : t('auth.signIn')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

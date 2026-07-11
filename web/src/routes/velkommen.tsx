import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/password-input'
import { BrandLogo } from '@/components/brand-logo'
import { supabase } from '@/lib/supabase'

// Accept-invitation / vælg-adgangskode. Invitations-linket (fra Resend, via
// generateLink type=invite) redirecter hertil med et engangs-token i URL'en;
// supabase-js opretter sessionen (detectSessionInUrl), og brugeren vælger sin
// adgangskode via updateUser. Offentlig rute (uden for _app-vagten).
export const Route = createFileRoute('/velkommen')({
  component: SetPasswordPage,
})

function SetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'checking' | 'ok' | 'invalid'>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Vent på at sessionen fra invitations-linket bliver etableret.
  useEffect(() => {
    let settled = false
    const ready = () => {
      settled = true
      setStatus('ok')
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!settled && data.session) ready()
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) ready()
    })
    const timer = setTimeout(() => {
      if (!settled) setStatus('invalid')
    }, 3000)
    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return setError(t('setPassword.tooShort'))
    if (password !== confirm) return setError(t('setPassword.mismatch'))
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) return setError(t('common.error'))
    toast.success(t('setPassword.done'))
    navigate({ to: '/' })
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[28px]">
            <BrandLogo className="h-6 w-6" />
            {t('setPassword.title')}
          </CardTitle>
          <CardDescription>
            {status === 'invalid' ? t('setPassword.invalidBody') : t('setPassword.subtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'checking' && (
            <p className="text-sm text-muted-foreground">{t('setPassword.checking')}</p>
          )}
          {status === 'invalid' && (
            <Button variant="outline" className="w-full" onClick={() => navigate({ to: '/login' })}>
              {t('setPassword.toLogin')}
            </Button>
          )}
          {status === 'ok' && (
            <form className="flex flex-col gap-4" onSubmit={submit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password">{t('setPassword.newPassword')}</Label>
                <PasswordInput
                  id="new-password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-password">{t('setPassword.confirm')}</Label>
                <PasswordInput
                  id="confirm-password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy}>
                {busy ? t('common.loading') : t('setPassword.submit')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

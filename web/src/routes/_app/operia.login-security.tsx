import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Field } from '@/components/detail-field'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { supabase } from '@/lib/supabase'

// Operia → Login & sikkerhed: platformens tilladte login-metoder (master
// switch). Virksomheder kan indsnævre yderligere på Konfigurér → Login &
// sikkerhed, men aldrig åbne en metode, der er slået fra her. "Biometrisk"
// dækker både fingeraftryk og ansigtsgenkendelse — enheden afgør selv
// verifikationen (WebAuthn/passkey på web, BiometricPrompt på håndterminalen).
export const Route = createFileRoute('/_app/operia/login-security')({
  component: LoginSecurityPage,
})

function LoginSecurityPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [password, setPassword] = useState(true)
  const [biometric, setBiometric] = useState(true)
  const [reauth, setReauth] = useState('0')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) {
      setPassword(data.login_password_enabled)
      setBiometric(data.login_biometric_enabled)
      setReauth(String(data.handheld_reauth_minutes))
    }
  }, [data])

  const parsedReauth = Number.parseInt(reauth, 10)
  const reauthValid = Number.isFinite(parsedReauth) && parsedReauth >= 0

  // Lockout-værn (spejler DB-checken): mindst én metode skal være tilbage.
  const valid = (password || biometric) && reauthValid
  const dirty =
    !!data &&
    valid &&
    (password !== data.login_password_enabled ||
      biometric !== data.login_biometric_enabled ||
      parsedReauth !== data.handheld_reauth_minutes)

  const save = async () => {
    if (!valid) return
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({
        login_password_enabled: password,
        login_biometric_enabled: biometric,
        handheld_reauth_minutes: parsedReauth,
      })
      .eq('id', true)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['platform-settings'] })
    queryClient.invalidateQueries({ queryKey: ['login-options'] })
  }

  const cancel = () => {
    if (data) {
      setPassword(data.login_password_enabled)
      setBiometric(data.login_biometric_enabled)
      setReauth(String(data.handheld_reauth_minutes))
    }
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('loginSecurityPage.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">
            {t('loginSecurityPage.subtitlePlatform')}
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-[13px] font-semibold">{t('loginSecurityPage.loginSection')}</h2>

          <Field
            label={t('loginSecurityPage.methodsLabel')}
            info={t('loginSecurityPage.methodsHint')}
          >
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="login-password" className="px-2.5 py-1.5 font-normal">
                <Checkbox
                  id="login-password"
                  checked={password}
                  onCheckedChange={(v) => setPassword(v === true)}
                />
                {t('loginSecurityPage.methodPassword')}
              </FieldLabel>
              <FieldLabel htmlFor="login-biometric" className="px-2.5 py-1.5 font-normal">
                <Checkbox
                  id="login-biometric"
                  checked={biometric}
                  onCheckedChange={(v) => setBiometric(v === true)}
                />
                {t('loginSecurityPage.methodBiometric')}
              </FieldLabel>
              {!valid && (
                <p className="text-sm text-destructive">{t('loginSecurityPage.atLeastOne')}</p>
              )}
              {/* Web-passkeys kræver et skridt uden for Operia — uden det
                  fejler login-knappen, så kravet står hvor kontakten er. */}
              {biometric && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('loginSecurityPage.dashboardHint')}
                </p>
              )}
              {/* Enheder tilmeldes fra /settings, hvilket kræver at man er
                  logget ind. Slukkes adgangskoden, kan ingen uden en allerede
                  tilmeldt enhed komme ind — derfor en eksplicit advarsel. */}
              {!password && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                  {t('loginSecurityPage.passwordOffWarning')}
                </p>
              )}
            </div>
          </Field>

          {/* Håndterminalen genoptager sin gemte session ved appstart, så uden
              et vindue står en terminal på bordet logget ind for altid. */}
          <Field
            label={t('loginSecurityPage.reauthLabel')}
            info={t('loginSecurityPage.reauthHint')}
          >
            <div className="flex items-center gap-2">
              <Input
                id="reauth-minutes"
                type="number"
                min={0}
                step={1}
                value={reauth}
                onChange={(e) => setReauth(e.target.value)}
                className="w-28"
                aria-invalid={!reauthValid}
              />
              <span className="text-sm text-muted-foreground">
                {t('loginSecurityPage.minutes')}
              </span>
            </div>
          </Field>
          <p className="-mt-2 text-xs text-muted-foreground">
            {parsedReauth === 0
              ? t('loginSecurityPage.reauthNever')
              : t('loginSecurityPage.reauthActive', { minutes: parsedReauth })}
          </p>
        </section>
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !valid}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}

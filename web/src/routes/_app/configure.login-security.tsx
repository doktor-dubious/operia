import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Field } from '@/components/detail-field'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

// Konfigurér → Login & sikkerhed: virksomhedens tilladte login-metoder.
// Kan kun indsnævre platformens valg (Operia → Login & sikkerhed) — en metode,
// der er slået fra på platformsniveau, vises deaktiveret. null i companies-
// kolonnerne = arv platformens værdi (effektiv = platform AND coalesce(firma,
// true)). Flagene styrer UI-synlighed og enrollment; selve password-grantet
// kan GoTrue ikke afvise pr. virksomhed på nuværende plan.
export const Route = createFileRoute('/_app/configure/login-security')({
  component: LoginSecurityPage,
})

function LoginSecurityPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data: platform, isPending: platformPending } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [password, setPassword] = useState(true)
  const [biometric, setBiometric] = useState(true)
  // Tom streng = arv platformens vindue (null i basen) — så en kunde kan lade
  // være at tage stilling, som ved de øvrige arvede indstillinger.
  const [reauth, setReauth] = useState('')
  const [saving, setSaving] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  // Nøglen deles med PasskeySection (/settings) — kolonnesættet skal være
  // identisk de to steder, ellers afhænger rækkens form af, hvem der hentede
  // sidst.
  const {
    data: company,
    isPending: companyPending,
    error: companyError,
  } = useQuery({
    queryKey: ['company-login-security', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('login_password_enabled, login_biometric_enabled, handheld_reauth_minutes')
        .eq('id', companyId!)
        .single()
      if (error) throw error
      return data
    },
  })

  useEffect(() => {
    if (company && platform) {
      setPassword(company.login_password_enabled ?? platform.login_password_enabled)
      setBiometric(company.login_biometric_enabled ?? platform.login_biometric_enabled)
      setReauth(
        company.handheld_reauth_minutes == null ? '' : String(company.handheld_reauth_minutes),
      )
    }
  }, [company, platform])

  // Uden fejlgrenen ville et mislykket opslag efterlade en skeleton, der
  // aldrig bliver til noget — umuligt at skelne fra "henter stadig".
  if (companyError)
    return (
      <div className="mx-auto w-full max-w-3xl py-6">
        <p className="text-sm text-destructive">{describeError(companyError, t)}</p>
      </div>
    )
  if (platformPending || companyPending || !platform || !company)
    return <Skeleton className="h-40 w-full" />

  const platformPassword = platform.login_password_enabled
  const platformBiometric = platform.login_biometric_enabled

  // Effektive værdier — en metode tæller kun, hvis platformen også tillader den.
  const effectivePassword = platformPassword && password
  const effectiveBiometric = platformBiometric && biometric
  const valid = effectivePassword || effectiveBiometric

  const stored = {
    password: company.login_password_enabled ?? platform.login_password_enabled,
    biometric: company.login_biometric_enabled ?? platform.login_biometric_enabled,
    reauth: company.handheld_reauth_minutes == null ? '' : String(company.handheld_reauth_minutes),
  }
  // Tomt felt = arv. Ellers skal det være et ikke-negativt heltal.
  const parsedReauth = reauth.trim() === '' ? null : Number.parseInt(reauth, 10)
  const reauthValid = parsedReauth === null || (Number.isFinite(parsedReauth) && parsedReauth >= 0)
  const dirty =
    valid &&
    reauthValid &&
    (password !== stored.password || biometric !== stored.biometric || reauth !== stored.reauth)
  const customized =
    company.login_password_enabled != null ||
    company.login_biometric_enabled != null ||
    company.handheld_reauth_minutes != null

  const persist = async (payload: {
    login_password_enabled: boolean | null
    login_biometric_enabled: boolean | null
    handheld_reauth_minutes: number | null
  }) => {
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('companies')
      .update(payload)
      .eq('id', companyId!)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return false
    }
    queryClient.invalidateQueries({ queryKey: ['company-login-security', companyId] })
    return true
  }

  const save = async () => {
    if (!valid) return
    // En metode, platformen har slået fra, kan ikke redigeres her — så dens
    // gemte værdi bevares uændret. Skrev vi null (arv), ville virksomhedens
    // bevidste fravalg blive slettet af et urelateret gem, og metoden ville
    // dukke op igen af sig selv, næste gang platformen åbnede den.
    const ok = await persist({
      login_password_enabled: platformPassword ? password : company.login_password_enabled,
      login_biometric_enabled: platformBiometric ? biometric : company.login_biometric_enabled,
      handheld_reauth_minutes: parsedReauth,
    })
    if (ok) toast.success(t('settings.saved'))
  }

  const reset = async () => {
    const ok = await persist({
      login_password_enabled: null,
      login_biometric_enabled: null,
      handheld_reauth_minutes: null,
    })
    setResetOpen(false)
    if (ok) toast.success(t('loginSecurityPage.resetToast'))
  }

  const cancel = () => {
    setPassword(stored.password)
    setBiometric(stored.biometric)
    setReauth(stored.reauth)
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('loginSecurityPage.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">
            {t('loginSecurityPage.subtitleCompany')}
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-[13px] font-semibold">{t('loginSecurityPage.loginSection')}</h2>

          <Field
            label={t('loginSecurityPage.methodsLabel')}
            info={t('loginSecurityPage.methodsHint')}
          >
            <div className="flex flex-col gap-2">
              <FieldLabel
                htmlFor="login-password"
                className="px-2.5 py-1.5 font-normal data-[disabled=true]:opacity-60"
                data-disabled={!platformPassword}
              >
                <Checkbox
                  id="login-password"
                  checked={effectivePassword}
                  disabled={!platformPassword}
                  onCheckedChange={(v) => setPassword(v === true)}
                />
                {t('loginSecurityPage.methodPassword')}
                {!platformPassword && (
                  <span className="text-xs text-muted-foreground">
                    {t('loginSecurityPage.platformDisabled')}
                  </span>
                )}
              </FieldLabel>
              <FieldLabel
                htmlFor="login-biometric"
                className="px-2.5 py-1.5 font-normal data-[disabled=true]:opacity-60"
                data-disabled={!platformBiometric}
              >
                <Checkbox
                  id="login-biometric"
                  checked={effectiveBiometric}
                  disabled={!platformBiometric}
                  onCheckedChange={(v) => setBiometric(v === true)}
                />
                {t('loginSecurityPage.methodBiometric')}
                {!platformBiometric && (
                  <span className="text-xs text-muted-foreground">
                    {t('loginSecurityPage.platformDisabled')}
                  </span>
                )}
              </FieldLabel>
              {!valid && (
                <p className="text-sm text-destructive">{t('loginSecurityPage.atLeastOne')}</p>
              )}
              {/* Uden adgangskode kan kun brugere med en allerede tilmeldt
                  enhed logge ind — tilmelding kræver jo et login først. */}
              {platformPassword && !password && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                  {t('loginSecurityPage.passwordOffWarning')}
                </p>
              )}
            </div>
          </Field>

          {/* Tomt felt = arv platformens vindue. */}
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
                placeholder={String(platform.handheld_reauth_minutes)}
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
            {parsedReauth === null
              ? t('loginSecurityPage.reauthInherited', {
                  minutes: platform.handheld_reauth_minutes,
                })
              : parsedReauth === 0
                ? t('loginSecurityPage.reauthNever')
                : t('loginSecurityPage.reauthActive', { minutes: parsedReauth })}
          </p>

          {customized && (
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground">
                {t('loginSecurityPage.customizedNote')}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setResetOpen(true)}
                disabled={saving}
              >
                {t('configureConfig.resetToDefault')}
              </Button>
            </div>
          )}
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

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('loginSecurityPage.resetTitle')}</DialogTitle>
            <DialogDescription>{t('loginSecurityPage.resetDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={reset}>
              {t('configureConfig.resetConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

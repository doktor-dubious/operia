import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Clock, Eye, EyeOff, FolderInput, KeyRound, Mail, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { TimePicker } from '@/components/time-picker'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { generateStrongPassword } from '@/lib/password'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Pr. virksomhed: hvilke dataoverførsels-kanaler kunden har slået til. Bruges to
// steder med samme UI: Konfigurér → Dataoverførsel (kunden selv, uden credentials)
// og Operia → Kunder → Dataoverførsel (platform-admin, MED credentials). Kun de
// kanaler platformen har aktiveret (Operia → Dataoverførsel) vises.

type ToggleState = {
  sftpOn: boolean
  emailOn: boolean
  scheduleOn: boolean
  scheduleTime: string
}
type SecretState = {
  sftpUsername: string
  emailName: string
  newPassword: string
  allowedSenders: string // én afsender pr. linje i UI'et
}

const DEFAULT_SCHEDULE_TIME = '09:00'
const EMPTY_TOGGLE: ToggleState = {
  sftpOn: false,
  emailOn: false,
  scheduleOn: false,
  scheduleTime: DEFAULT_SCHEDULE_TIME,
}
const EMPTY_SECRET: SecretState = { sftpUsername: '', emailName: '', newPassword: '', allowedSenders: '' }

// Fri tekst (linjer/komma) → normaliseret, deduplikeret liste af tilladte
// afsendere (fuld adresse eller @domæne, små bogstaver).
function parseSenders(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(/[\n,]+/)) {
    const v = part.trim().toLowerCase()
    if (v) seen.add(v)
  }
  return [...seen]
}

export function CompanyDataTransferFields({
  companyId,
  admin = false,
}: {
  companyId: string
  admin?: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: platform, isPending: platformPending } = usePlatformSettings()

  const { data: toggleRow, isPending: togglePending } = useQuery({
    queryKey: ['company-data-transfer', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_data_transfer')
        .select('sftp_enabled, email_enabled, import_schedule_enabled, import_schedule_time')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const { data: secretRow, isPending: secretPending } = useQuery({
    queryKey: ['company-data-transfer-secret', companyId],
    enabled: admin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_data_transfer_secret')
        .select('sftp_username, sftp_password_set, email_name, email_allowed_senders')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const [toggle, setToggle] = useState<ToggleState>(EMPTY_TOGGLE)
  const [secret, setSecret] = useState<SecretState>(EMPTY_SECRET)
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const initialToggle: ToggleState = useMemo(
    () => ({
      sftpOn: toggleRow?.sftp_enabled ?? false,
      emailOn: toggleRow?.email_enabled ?? false,
      scheduleOn: toggleRow?.import_schedule_enabled ?? false,
      scheduleTime: toggleRow?.import_schedule_time?.slice(0, 5) || DEFAULT_SCHEDULE_TIME,
    }),
    [toggleRow],
  )
  const initialSecret: SecretState = useMemo(
    () => ({
      sftpUsername: secretRow?.sftp_username ?? '',
      emailName: secretRow?.email_name ?? '',
      newPassword: '',
      allowedSenders: (secretRow?.email_allowed_senders ?? []).join('\n'),
    }),
    [secretRow],
  )

  useEffect(() => {
    setToggle(initialToggle)
  }, [initialToggle])
  useEffect(() => {
    setSecret(initialSecret)
  }, [initialSecret])

  const passwordSet = secretRow?.sftp_password_set ?? false
  const dirty =
    JSON.stringify(toggle) !== JSON.stringify(initialToggle) ||
    (admin && JSON.stringify(secret) !== JSON.stringify(initialSecret))

  const sftpAvailable = platform?.sftp_enabled ?? false
  const emailAvailable = platform?.email_enabled ?? false
  const baseDomain = platform?.email_base_domain ?? ''

  const save = async () => {
    // email-inbound matcher modtagerens local part lowercased og case-sensitivt
    // mod email_name — normalisér og validér her, ellers kan et navn med store
    // bogstaver (eller fx et mellemrum) aldrig modtage post.
    const emailName = secret.emailName.trim().toLowerCase()
    if (admin && emailName && !/^[a-z0-9._-]+$/.test(emailName)) {
      toast.error(t('companyDataTransfer.emailNameInvalid'))
      return
    }
    setSaving(true)
    const toggleRes = await supabase
      .from('company_data_transfer')
      .upsert(
        {
          company_id: companyId,
          sftp_enabled: toggle.sftpOn,
          email_enabled: toggle.emailOn,
          import_schedule_enabled: toggle.scheduleOn,
          import_schedule_time: toggle.scheduleTime || null,
        },
        { onConflict: 'company_id' },
      )
    let secretErr = null
    if (admin) {
      // Brugernavn/e-mail-navn skrives direkte; adgangskoden går KUN via
      // set_company_sftp_password (bcrypt-hashes server-side, aldrig i klartekst).
      const res = await supabase
        .from('company_data_transfer_secret')
        .upsert(
          {
            company_id: companyId,
            sftp_username: secret.sftpUsername.trim() || null,
            // email-inbound matcher på den lowercasede local part af
            // modtageradressen — gem derfor altid med små bogstaver.
            email_name: secret.emailName.trim().toLowerCase() || null,
            email_allowed_senders: parseSenders(secret.allowedSenders),
          },
          { onConflict: 'company_id' },
        )
      secretErr = res.error
      if (!secretErr && secret.newPassword.trim()) {
        const pw = await supabase.rpc('set_company_sftp_password', {
          p_company_id: companyId,
          p_password: secret.newPassword.trim(),
        })
        secretErr = pw.error
      }
    }
    setSaving(false)
    if (toggleRes.error || secretErr) {
      // 23505 = unik-constraint: brugernavn/e-mail-navn er allerede i brug hos en
      // anden virksomhed (nøglerne er globalt unikke, så hook'en kan afbilde entydigt).
      if (secretErr?.code === '23505') toast.error(t('companyDataTransfer.identifierTaken'))
      else toast.error(describeError(secretErr ?? toggleRes.error, t))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-data-transfer', companyId] })
    queryClient.invalidateQueries({ queryKey: ['company-data-transfer-secret', companyId] })
    setSecret((s) => ({ ...s, newPassword: '' }))
    setShowPassword(false)
  }

  if (platformPending || togglePending || (admin && secretPending)) {
    return <Skeleton className="h-40 w-full" />
  }

  if (!sftpAvailable && !emailAvailable) {
    return (
      <p className="max-w-xl text-sm text-muted-foreground">{t('companyDataTransfer.noneEnabled')}</p>
    )
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {/* SFTP */}
      {sftpAvailable && (
        <div className="rounded-md border p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={toggle.sftpOn}
              onCheckedChange={(v) => setToggle((s) => ({ ...s, sftpOn: v === true }))}
            />
            <span className="flex items-center gap-2">
              <FolderInput className="size-4 text-muted-foreground" />
              <span>
                <span className="text-[13px] font-[450]">{t('companyDataTransfer.sftp')}</span>
                <span className="block text-xs text-muted-foreground">
                  {platform?.sftp_host
                    ? t('companyDataTransfer.sftpHostLine', { host: platform.sftp_host })
                    : t('companyDataTransfer.sftpDesc')}
                </span>
              </span>
            </span>
          </label>
          {admin && toggle.sftpOn && (
            <div className="mt-4 grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-2 pl-7">
              <Label className="text-label">{t('companyDataTransfer.username')}</Label>
              <Input
                value={secret.sftpUsername}
                className="h-8 font-mono text-xs"
                onChange={(e) => setSecret((s) => ({ ...s, sftpUsername: e.target.value }))}
              />
              <Label className="text-label">{t('companyDataTransfer.password')}</Label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={secret.newPassword}
                    placeholder={passwordSet ? '••••••••' : t('companyDataTransfer.passwordUnset')}
                    className="h-8 pr-8 font-mono text-xs"
                    onChange={(e) => setSecret((s) => ({ ...s, newPassword: e.target.value }))}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t('common.hide') : t('common.show')}
                    title={showPassword ? t('common.hide') : t('common.show')}
                    className={cn(
                      'absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center',
                      'rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => {
                    setSecret((s) => ({ ...s, newPassword: generateStrongPassword() }))
                    setShowPassword(true)
                  }}
                >
                  <KeyRound className="size-3.5" />
                  {t('userDetail.generatePassword')}
                </Button>
              </div>
              <span />
              <p className="text-xs text-muted-foreground">
                {passwordSet
                  ? t('companyDataTransfer.passwordKeep')
                  : t('companyDataTransfer.passwordHint')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Automatisk e-mail */}
      {emailAvailable && (
        <div className="rounded-md border p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={toggle.emailOn}
              onCheckedChange={(v) => setToggle((s) => ({ ...s, emailOn: v === true }))}
            />
            <span className="flex items-center gap-2">
              <Mail className="size-4 text-muted-foreground" />
              <span>
                <span className="text-[13px] font-[450]">{t('companyDataTransfer.email')}</span>
                <span className="block text-xs text-muted-foreground">
                  {t('companyDataTransfer.emailDesc')}
                </span>
              </span>
            </span>
          </label>
          {admin && toggle.emailOn && (
            <div className="mt-4 flex flex-col gap-2 pl-7">
              <Label className="text-label">{t('companyDataTransfer.emailName')}</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  value={secret.emailName}
                  placeholder="nordwind"
                  className="h-8 max-w-40 font-mono text-xs"
                  onChange={(e) => setSecret((s) => ({ ...s, emailName: e.target.value }))}
                />
                <span className="font-mono text-xs text-muted-foreground">
                  @{baseDomain || 'operia.com'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{t('companyDataTransfer.emailNameHint')}</p>

              {/* Afsender-allowlist (sikkerhed) */}
              <Label className="mt-2 text-label">{t('companyDataTransfer.allowedSenders')}</Label>
              <Textarea
                value={secret.allowedSenders}
                rows={3}
                placeholder={'hr@kunde.dk\n@kunde.dk'}
                className="font-mono text-xs"
                onChange={(e) => setSecret((s) => ({ ...s, allowedSenders: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                {t('companyDataTransfer.allowedSendersHint')}
              </p>
              {parseSenders(secret.allowedSenders).length === 0 && (
                <p className="flex items-start gap-1.5 text-xs text-status-neutral-to-bad">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {platform?.email_allowlist_required
                    ? t('companyDataTransfer.allowedSendersBlocked')
                    : t('companyDataTransfer.allowedSendersWarning')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Planlagt import: kør kun på et fast klokkeslæt (kun relevant når en
          kanal er slået til). Kunde-redigerbart. */}
      {(toggle.sftpOn || toggle.emailOn) && (
        <div className="rounded-md border p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={toggle.scheduleOn}
              onCheckedChange={(v) => setToggle((s) => ({ ...s, scheduleOn: v === true }))}
            />
            <span className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" />
              <span>
                <span className="text-[13px] font-[450]">{t('companyDataTransfer.schedule')}</span>
                <span className="block text-xs text-muted-foreground">
                  {t('companyDataTransfer.scheduleDesc')}
                </span>
              </span>
            </span>
          </label>
          {toggle.scheduleOn && (
            <div className="mt-4 flex flex-col gap-2 pl-7">
              <Label className="text-label">{t('companyDataTransfer.scheduleTime')}</Label>
              <TimePicker
                value={toggle.scheduleTime}
                onChange={(v) => setToggle((s) => ({ ...s, scheduleTime: v }))}
                ariaLabel={t('companyDataTransfer.scheduleTime')}
              />
              <p className="text-xs text-muted-foreground">
                {t('companyDataTransfer.scheduleHint')}
              </p>
            </div>
          )}
        </div>
      )}

      {dirty && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => {
              setToggle(initialToggle)
              setSecret(initialSecret)
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}

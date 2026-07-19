import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { GeneratablePasswordField } from '@/components/generatable-password-field'
import { readEdgeError } from '@/lib/edge'
import { supabase } from '@/lib/supabase'

// Skift adgangskode for en eksisterende bruger. Mønstret spejler invite-popup'en:
// enten indtaster/genererer man en fast adgangskode, eller man slår kontakten til
// og sender brugeren et nulstillingslink, så de selv vælger en ny. Selve
// ændringen sker server-side (set-user-password edge-funktion, service-role, der
// genverificerer at kalderen er manager/platform-admin for brugerens virksomhed).
export function ChangePasswordDialog({
  open,
  onOpenChange,
  userId,
  email,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  email: string | null
}) {
  const { t } = useTranslation()
  const [sendEmail, setSendEmail] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setSendEmail(false)
    setPassword('')
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const canSubmit = sendEmail
    ? !!email
    : password.length >= 8

  const submit = async () => {
    if (busy || !canSubmit) return
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('set-user-password', {
      body: {
        userId,
        mode: sendEmail ? 'invite' : 'set',
        password: sendEmail ? undefined : password,
      },
    })
    setBusy(false)
    if (error) {
      toast.error(
        await readEdgeError(error, t('common.error'), {
          password_too_short: t('changePassword.tooShort'),
          no_email: t('changePassword.noEmail'),
        }),
      )
      return
    }
    if (sendEmail && data?.emailSent === false) {
      toast.warning(t('common.emailFailed'))
    } else {
      toast.success(
        sendEmail
          ? t('changePassword.resetEmailSent', { email })
          : t('changePassword.passwordChanged'),
      )
    }
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('changePassword.title')}</DialogTitle>
          <DialogDescription>{t('changePassword.intro')}</DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <p className="text-[13px] font-[450]">{t('changePassword.sendReset')}</p>
            <p className="text-xs text-muted-foreground">{t('changePassword.sendResetHint')}</p>
          </div>
          <Switch checked={sendEmail} onCheckedChange={setSendEmail} disabled={!email} />
        </label>

        {!sendEmail && (
          <GeneratablePasswordField
            id="new-pw"
            label={t('changePassword.newPassword')}
            value={password}
            onChange={setPassword}
            placeholder={t('changePassword.newPasswordPlaceholder')}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !canSubmit} onClick={submit}>
            {busy
              ? sendEmail
                ? t('userDetail.sending')
                : t('common.loading')
              : sendEmail
                ? t('changePassword.sendResetAction')
                : t('changePassword.setAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

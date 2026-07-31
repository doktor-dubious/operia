import { useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useSession } from '@/hooks/use-session'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// "Kontakt Operia" fra Konfigurér → Produkter & funktioner: kunden kan bede om
// adgang til et produkt eller en funktion, de ikke har. Tildelinger er
// DCA-ejede, så anmodningen ændrer intet — den lander i DCA's feedback-indbakke
// (kind = 'access') med produkt-/funktionsnøglen i 'subject', og DCA aktiverer
// den manuelt på Operia → Kunder.
export function RequestAccessDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: { kind: 'product' | 'feature'; key: string; name: string; productName?: string } | null
}) {
  const { t } = useTranslation()
  const { session } = useSession()
  const { companyId } = useCompanyContext()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) setMessage('')
    onOpenChange(next)
  }

  const email = session?.user.email ?? null

  const send = async () => {
    const userId = session?.user.id
    if (!target || !userId || busy) return
    setBusy(true)
    try {
      const { error } = await supabase.from('feedback').insert({
        user_id: userId,
        company_id: companyId,
        kind: 'access',
        // Nøglen med i emnet, så DCA kan slå præcis det rigtige produkt op —
        // navnet alene er oversat og kan ændre sig.
        subject: `${t(`requestAccess.${target.kind}`)}: ${target.name} (${target.key})`,
        message: message.trim() || t('requestAccess.defaultMessage', { name: target.name }),
        page_path: pathname,
      })
      if (error) throw error
      toast.success(t('requestAccess.sent'))
      handleOpenChange(false)
    } catch (error) {
      console.error('Adgangsanmodning fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('requestAccess.title')}</DialogTitle>
          <DialogDescription>{t('requestAccess.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">
              {target ? t(`requestAccess.${target.kind}`) : ''}
            </p>
            <p className="text-[13px] font-[450]">{target?.name}</p>
            {target?.productName && (
              <p className="text-xs text-muted-foreground">{target.productName}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="request-access-message">
              {t('requestAccess.messageLabel')}{' '}
              <span className="text-muted-foreground">({t('common.optional')})</span>
            </Label>
            <Textarea
              id="request-access-message"
              autoFocus
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('requestAccess.placeholder')}
              className="resize-none"
            />
          </div>

          {email && (
            <p className="text-xs text-muted-foreground">
              {t('requestAccess.replyTo', { email })}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={send} disabled={busy || !target}>
            {busy ? t('common.loading') : t('requestAccess.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

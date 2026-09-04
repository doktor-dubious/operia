import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { FieldLabel } from '@/components/ui/field'
import { describeError } from '@/lib/errors'
import { CHANNEL_LABEL_KEY, notifyReasonLabel, type NotifyChannel } from '@/lib/notify-contact'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Testknap til statusbeskeden (Konfigurér → Notifikationer → Statusbesked).
// Åbner en dialog med de modtagere der lige nu har en statusbesked på vej —
// listen kommer fra edge-funktionen send-test-status, som bruger PRÆCIS samme
// udvælgelse som den planlagte udsendelse. Manageren vælger én og sender.
//
// Testen springer klokkeslæt, stilletid og statusbesked-togglen over (det er en
// manuel handling der skal kunne bruges før man slår funktionen til), men
// respekterer kanalvalget — det er netop skabelon + levering der testes.
// Serveren genverificerer rollen og at modtageren hører til virksomheden.

type Candidate = {
  employeeId: string
  name: string | null
  email: string | null
  phone: string | null
  // Hvilke af virksomhedens aktive kanaler denne modtager faktisk har en
  // adresse på. Serveren afgør det — den kender også Teams-adressen, som
  // bevidst ikke sendes med hertil.
  reachable: NotifyChannel[]
  count: number
  deliveredCount: number
}

type Preview = {
  ok: boolean
  channels: NotifyChannel[]
  notificationsEnabled: boolean
  candidates: Candidate[]
}

export function StatusTestDialog({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  // Maskinkoden fra classifySendError → læsbar tekst. Deler nøgler med Logs,
  // så en fejl hedder det samme begge steder; ukendte koder vises råt frem for
  // at blive slugt.
  const reasonText = (code?: string): string => notifyReasonLabel(code, t)

  // Hentes ved åbning (ikke via useQuery): listen skal være frisk hver gang,
  // og den koster et edge-kald vi ikke vil lave uopfordret.
  const openDialog = async () => {
    setOpen(true)
    setPreview(null)
    setSelected(null)
    setLoading(true)
    const { data, error } = await supabase.functions.invoke('send-test-status', {
      body: { companyId, mode: 'preview' },
    })
    setLoading(false)
    if (error) {
      toast.error(describeError(error, t))
      setOpen(false)
      return
    }
    setPreview(data as Preview)
    // Er der kun én kandidat, er valget givet.
    const list = (data as Preview).candidates
    if (list.length === 1) setSelected(list[0].employeeId)
  }

  const send = async () => {
    if (!selected) return
    setSending(true)
    const { data, error } = await supabase.functions.invoke('send-test-status', {
      body: { companyId, mode: 'send', employeeId: selected },
    })
    setSending(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    const res = data as {
      ok: boolean
      count?: number
      error?: string
      channels?: NotifyChannel[]
      results?: { channel: NotifyChannel; ok: boolean; reason?: string }[]
    }
    if (res.ok) {
      toast.success(t('notificationsPage.statusTestOk', { count: res.count ?? 0 }))
      setOpen(false)
      return
    }
    // Fejlede ALLE kanaler, står årsagen pr. kanal i results — der er intet
    // fejlfelt på topniveau i det tilfælde, og uden dette faldt dialogen
    // tilbage på det intetsigende "unknown".
    const failed = (res.results ?? []).filter((r) => !r.ok)
    if (!res.error && failed.length) {
      toast.error(
        t('notificationsPage.statusTestFail', {
          error: failed
            .map((r) => `${t(CHANNEL_LABEL_KEY[r.channel])}: ${reasonText(r.reason)}`)
            .join(' · '),
        }),
      )
      return
    }
    // Kendte årsager oversættes; alt andet vises råt, så fejlen ikke forsvinder.
    const known = ['notifications_disabled', 'no_pending_parcels', 'no_channels', 'missing_addon']
    // 'missing_addon' navngiver de valgte kanaler kunden mangler tilvalget til
    // — ellers ville beskeden bede manageren vælge en kanal der ALLEREDE er valgt.
    const names = (res.channels ?? []).map((c) => t(CHANNEL_LABEL_KEY[c])).join(', ')
    toast.error(
      t('notificationsPage.statusTestFail', {
        error: known.includes(res.error ?? '')
          ? t(`notificationsPage.statusTestErr.${res.error}`, { channels: names })
          : (res.error ?? 'unknown'),
      }),
    )
  }

  const candidates = preview?.candidates ?? []
  // Har modtageren ingen adresse på nogen af de aktive kanaler, er der ingen
  // vej frem for personen.
  const isReachable = (c: Candidate) => (c.reachable?.length ?? 0) > 0

  // Undertekst pr. modtager: e-mail/telefon vises som de er, mens chat-kanaler
  // kun nævnes ved navn — deres adresse er et internt id uden værdi for en
  // manager (og hører ikke hjemme på skærmen).
  const contactLine = (c: Candidate) =>
    (c.reachable ?? [])
      .map((ch) => {
        if (ch === 'email') return c.email
        if (ch === 'sms') return c.phone
        return t(CHANNEL_LABEL_KEY[ch])
      })
      .filter(Boolean)
      .join(' · ')

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="mt-1" onClick={openDialog}>
        <Send className="size-4" />
        {t('notificationsPage.statusTestButton')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('notificationsPage.statusTestTitle')}</DialogTitle>
            <DialogDescription>
              {t('notificationsPage.statusTestDescription')}
            </DialogDescription>
          </DialogHeader>

          {/* Modtagerlisten kræver et edge-kald (to pakkeforespørgsler), så den
              er sjældent øjeblikkelig — vis en spinner mens den hentes. */}
          {loading && (
            <div
              className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="size-4 animate-spin" />
              {t('notificationsPage.statusTestLoading')}
            </div>
          )}

          {!loading && preview && candidates.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              {t('notificationsPage.statusTestEmpty')}
            </p>
          )}

          {!loading && candidates.length > 0 && (
            <div className="flex flex-col gap-3">
              {!preview?.notificationsEnabled && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-muted-foreground">
                  {t('notificationsPage.statusTestErr.notifications_disabled')}
                </p>
              )}
              <RadioGroup
                value={selected ?? ''}
                onValueChange={setSelected}
                className="max-h-72 gap-1 overflow-y-auto"
              >
                {candidates.map((c) => {
                  const ok = isReachable(c)
                  return (
                    <FieldLabel
                      key={c.employeeId}
                      htmlFor={`st-${c.employeeId}`}
                      className={cn('px-2.5 py-2 font-normal', !ok && 'opacity-50')}
                    >
                      <RadioGroupItem
                        value={c.employeeId}
                        id={`st-${c.employeeId}`}
                        disabled={!ok}
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate">{c.name ?? '—'}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {contactLine(c) || t('notificationsPage.statusTestNoContact')}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        {[
                          c.count > 0 && t('notificationsPage.statusTestCount', { count: c.count }),
                          c.deliveredCount > 0 &&
                            t('notificationsPage.statusTestCountDelivered', {
                              count: c.deliveredCount,
                            }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </FieldLabel>
                  )
                })}
              </RadioGroup>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={send} disabled={!selected || sending}>
              {sending ? t('common.loading') : t('notificationsPage.statusTestSend')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

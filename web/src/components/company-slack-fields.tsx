import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearch } from '@tanstack/react-router'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Check, Link2, Link2Off, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Field } from '@/components/detail-field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabase'

// Pr. virksomhed: Slack-installationen.
//
// Modsat Entra indtaster kunden ingenting. Hele opsætningen er ét OAuth-flow:
// "Forbind til Slack" → godkend i eget workspace → Slack sender browseren
// tilbage til edge-funktionen slack-oauth, som gemmer bot-tokenet. Siden viser
// derfor kun TILSTAND (hvilket workspace, hvornår) plus tre handlinger.
//
// Bot-tokenet kan ikke læses herfra: company_slack_secret har hverken
// RLS-politikker eller grants. "Forbundet ✓" kommer fra det spejlede flag
// token_set i company_slack_config.

type Row = {
  team_id: string | null
  team_name: string | null
  bot_user_id: string | null
  token_set: boolean
  connected_at: string | null
}

export function CompanySlackFields({ companyId }: { companyId: string }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<null | 'start' | 'test' | 'disconnect'>(null)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const { data, isPending } = useQuery({
    queryKey: ['company-slack', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_slack_config')
        .select('team_id, team_name, bot_user_id, token_set, connected_at')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as Row | null
    },
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['company-slack', companyId] })

  // Opslag på e-mail er et tilvalg pr. kunde (companies.slack_lookup_by_email,
  // læst af _shared/channels.ts). Ligger på companies — ikke i
  // company_slack_config, som kun service-role skriver — så manageren kan
  // sætte det direkte, som de øvrige kanalvalg på Konfigurér → Notifikationer.
  const { data: lookup } = useQuery({
    queryKey: ['company-slack-lookup', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('slack_lookup_by_email')
        .eq('id', companyId)
        .single()
      if (error) throw error
      return data.slack_lookup_by_email
    },
  })
  const setLookup = async (on: boolean) => {
    const { error } = await supabase
      .from('companies')
      .update({ slack_lookup_by_email: on })
      .eq('id', companyId)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('companySlack.lookupSaved'))
    queryClient.invalidateQueries({ queryKey: ['company-slack-lookup', companyId] })
    // Modtagelsesformularens "kan ikke nås"-advarsel læser samme kolonne.
    queryClient.invalidateQueries({ queryKey: ['arrival-notify-config', companyId] })
  }

  // Slack kan finde på at svare med en fejlkode vi ikke har oversat endnu. Så
  // vises koden råt i stedet for at fejlen forsvinder — men uden i18next'
  // fallback-overload, som gør returtypen til en union der ikke kan rendres.
  const outcomeText = (code: string): string => {
    const key = `companySlack.outcome_${code}`
    const text = t(key)
    return text === key ? code : text
  }

  // slack-oauth sender browseren tilbage hertil med ?slack=<udfald>. Vises som
  // en toast og ryddes straks ud af URL'en, så et genbesøg/refresh ikke gentager
  // beskeden. Kun kendte udfald oversættes; alt andet vises råt frem for at
  // forsvinde.
  const search = useSearch({ strict: false }) as { slack?: string }
  useEffect(() => {
    const outcome = search?.slack
    if (!outcome) return
    if (outcome === 'connected') {
      toast.success(t('companySlack.connectOk'))
      refresh()
    } else {
      toast.error(t('companySlack.connectFail', { error: outcomeText(outcome) }))
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('slack')
    window.history.replaceState({}, '', url.toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search?.slack])

  const connect = async () => {
    setBusy('start')
    const { data: res, error } = await supabase.functions.invoke('slack-config', {
      body: { companyId, action: 'start' },
    })
    setBusy(null)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    if (!res?.ok || !res.url) {
      toast.error(outcomeText(res?.reason ?? 'not_configured'))
      return
    }
    // Slacks godkendelsesside — kunden vender tilbage via slack-oauth.
    window.location.assign(res.url)
  }

  const test = async () => {
    setBusy('test')
    const { data: res, error } = await supabase.functions.invoke('slack-config', {
      body: { companyId, action: 'test' },
    })
    setBusy(null)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    if (res?.ok) toast.success(t('companySlack.testOk', { team: res.team ?? '—' }))
    else toast.error(outcomeText(res?.reason ?? 'auth_failed'))
  }

  const disconnect = async () => {
    setBusy('disconnect')
    const { data: res, error } = await supabase.functions.invoke('slack-config', {
      body: { companyId, action: 'disconnect' },
    })
    setBusy(null)
    setDisconnectOpen(false)
    if (error || !res?.ok) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('companySlack.disconnectOk'))
    refresh()
  }

  if (isPending) return <Skeleton className="h-32 w-full" />

  const connected = !!data?.token_set

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <Field label={t('companySlack.status')} info={t('companySlack.statusHint')}>
        {connected ? (
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-sm text-status-good">
              <Check className="size-4" />
              {t('companySlack.connectedTo', { team: data?.team_name ?? data?.team_id ?? '—' })}
            </span>
            {data?.connected_at && (
              <span className="text-xs text-muted-foreground">
                {t('companySlack.connectedAt', {
                  date: new Date(data.connected_at).toLocaleString(i18n.language),
                })}
              </span>
            )}
          </div>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <TriangleAlert className="size-4" />
            {t('companySlack.notConnected')}
          </span>
        )}
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant={connected ? 'outline' : 'default'} disabled={!!busy} onClick={connect}>
          <Link2 className="size-4" />
          {connected ? t('companySlack.reconnect') : t('companySlack.connect')}
        </Button>
        {connected && (
          <>
            <Button type="button" variant="outline" disabled={!!busy} onClick={test}>
              {busy === 'test' ? t('common.loading') : t('companySlack.test')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              disabled={!!busy}
              onClick={() => setDisconnectOpen(true)}
            >
              <Link2Off className="size-4" />
              {t('companySlack.disconnect')}
            </Button>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t('companySlack.channelHint')}</p>

      <Field label={t('companySlack.lookupByEmail')} info={t('companySlack.lookupByEmailHint')}>
        <FieldLabel htmlFor="slack-lookup" className="px-2.5 py-1.5 font-normal">
          <Checkbox
            id="slack-lookup"
            checked={lookup === true}
            disabled={lookup === undefined}
            onCheckedChange={(v) => void setLookup(v === true)}
          />
          {t('companySlack.lookupByEmail')}
        </FieldLabel>
      </Field>

      {/* Almindelig bekræftelse, ikke ConfirmDeleteDialog: at afbryde er
          reversibelt (man forbinder bare igen), så skriv-ordet-ceremonien hører
          ikke til her. Intet data går tabt — kun tokenet. */}
      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('companySlack.disconnectTitle')}</DialogTitle>
            <DialogDescription>{t('companySlack.disconnectDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={busy === 'disconnect'} onClick={disconnect}>
              {t('companySlack.disconnect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

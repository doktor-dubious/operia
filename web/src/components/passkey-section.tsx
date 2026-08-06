import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Fingerprint, Trash2 } from 'lucide-react'
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
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'
import { classifyPasskeyError, passkeyErrorName } from '@/lib/passkey-errors'

// Biometrisk login (passkeys/WebAuthn): tilmeld enheden, se og fjern
// tilmeldte enheder. Vises kun når metoden er tilladt (platform AND firma —
// samme regel som login-siden/håndterminalen) og browseren kan WebAuthn.
// Selve verifikationen (fingeraftryk/ansigt/PIN) vælger enheden selv; der
// gemmes aldrig biometriske data — kun en offentlig nøgle hos Supabase.

type PasskeyItem = {
  id: string
  friendly_name?: string
  created_at: string
  last_used_at?: string
}

// auth-js' passkey-namespace er eksperimentelt og ikke med i supabase-js'
// bundtede typer — kaldes derfor via en minimal lokal kontrakt.
type PasskeyApi = {
  list(): Promise<{ data: PasskeyItem[] | null; error: { message: string } | null }>
  update(params: {
    passkeyId: string
    friendlyName: string
  }): Promise<{ error: { message: string } | null }>
  delete(params: { passkeyId: string }): Promise<{ error: { message: string } | null }>
}

const passkeyApi = () =>
  (supabase.auth as unknown as { passkey: PasskeyApi }).passkey

/** Fejlbeskeden for hver WebAuthn-årsag ved TILMELDING. 'cancelled' er ikke
 *  med: brugerens eget afbrud vises ikke. */
const ADD_ERROR_MESSAGE: Record<string, string> = {
  origin: 'settings.passkeyOriginError',
  unsupported: 'settings.passkeyUnsupportedError',
  alreadyRegistered: 'settings.passkeyAlreadyError',
  constraint: 'settings.passkeyConstraintError',
  unknown: 'settings.passkeyAddError',
}

/** Auto-navn til en ny passkey: "Windows · Chrome" o.l. — kan ses i listen,
 *  så brugeren kan kende sine enheder fra hinanden. */
function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /Macintosh|Mac OS/i.test(ua)
      ? 'macOS'
      : /Android/i.test(ua)
        ? 'Android'
        : /iPhone|iPad/i.test(ua)
          ? 'iOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : '?'
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Chrome\//i.test(ua)
      ? 'Chrome'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Safari\//i.test(ua)
          ? 'Safari'
          : '?'
  return `${os} · ${browser}`
}

export function PasskeySection({
  Panel,
  PanelRow,
  SectionHeader,
}: {
  Panel: React.ComponentType<{ children: React.ReactNode }>
  PanelRow: React.ComponentType<{
    label: string
    description?: string
    children: React.ReactNode
    wide?: boolean
  }>
  SectionHeader: React.ComponentType<{ title: string; subtitle?: string }>
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { companyId } = useCompanyContext()
  const { data: platform } = usePlatformSettings()
  const [busy, setBusy] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Nøglen deles med Konfigurér → Login & sikkerhed, så kolonnesættet SKAL
  // være identisk: cachen holder én række pr. nøgle, og en smallere række
  // herfra ville lade den side se handheld_reauth_minutes som undefined — og
  // et "Gem" dér ville så slette kundens konfigurerede vindue.
  const { data: company } = useQuery({
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

  const allowed =
    (platform?.login_biometric_enabled ?? false) &&
    (companyId ? (company?.login_biometric_enabled ?? true) : true)
  const supported = typeof window !== 'undefined' && !!window.PublicKeyCredential

  const { data: passkeys } = useQuery({
    queryKey: ['passkeys'],
    enabled: allowed && supported,
    queryFn: async () => {
      const { data, error } = await passkeyApi().list()
      if (error) throw error
      return data ?? []
    },
  })

  if (!allowed || !supported) return null

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['passkeys'] })

  /** Vis årsagen, ikke bare "det gik galt": fejlens tekniske navn kommer med
   *  som toast-beskrivelse, så en support-henvendelse kan citere den. */
  const showAddError = (err: unknown) => {
    const kind = classifyPasskeyError(err)
    if (kind === 'cancelled') return
    const detail = passkeyErrorName(err)
    toast.error(t(ADD_ERROR_MESSAGE[kind] ?? 'settings.passkeyAddError', { host: window.location.host }), {
      description: detail ? t('auth.errorDetail', { detail }) : undefined,
    })
  }

  const add = async () => {
    setBusy(true)
    try {
      // Gentjek serverens aktuelle værdi lige før tilmelding: `allowed` kan
      // stamme fra en cachet forespørgsel, og uden dette ville en admin, der
      // netop har slået metoden fra, stadig kunne få nye enheder tilmeldt.
      const { data: fresh } = await supabase
        .from('companies')
        .select('login_biometric_enabled')
        .eq('id', companyId!)
        .maybeSingle()
      if (fresh?.login_biometric_enabled === false) {
        toast.error(t('settings.passkeyNotAllowed'))
        queryClient.invalidateQueries({ queryKey: ['company-login-security', companyId] })
        return
      }
      const { data, error } = await supabase.auth.registerPasskey()
      if (error) {
        showAddError(error)
        return
      }
      // Navngiv nøglen efter enheden, så listen kan læses. Fejl her er
      // uskadelige — nøglen virker uden navn.
      if (data?.id) {
        await passkeyApi()
          .update({ passkeyId: data.id, friendlyName: deviceLabel() })
          .catch(() => {})
      }
      toast.success(t('settings.passkeyAdded'))
      refresh()
    } catch (e) {
      showAddError(e)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!deleteId) return
    setBusy(true)
    const { error } = await passkeyApi().delete({ passkeyId: deleteId })
    setBusy(false)
    setDeleteId(null)
    if (error) {
      toast.error(t('settings.passkeyDeleteError'))
      return
    }
    toast.success(t('settings.passkeyDeleted'))
    refresh()
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.resolvedLanguage ?? 'da', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  return (
    <section className="mt-10">
      <SectionHeader
        title={t('settings.securitySection')}
        subtitle={t('settings.securitySubtitle')}
      />
      <Panel>
        <PanelRow
          label={t('settings.passkeyListLabel')}
          description={t('settings.passkeyListDescription')}
          wide
        >
          <div className="flex flex-col gap-2">
            {(passkeys ?? []).length === 0 && (
              <p className="py-1 text-sm text-muted-foreground">{t('settings.passkeyEmpty')}</p>
            )}
            {(passkeys ?? []).map((pk) => (
              <div
                key={pk.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2.5">
                  <Fingerprint className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-[13px] font-[450] text-foreground">
                      {pk.friendly_name || t('settings.passkeyUnnamed')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.passkeyCreated', { date: formatDate(pk.created_at) })}
                      {pk.last_used_at &&
                        ` · ${t('settings.passkeyLastUsed', { date: formatDate(pk.last_used_at) })}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteId(pk.id)}
                  disabled={busy}
                  aria-label={t('settings.passkeyDelete')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </PanelRow>
        <div className="flex justify-end px-6 py-3">
          <Button size="sm" onClick={add} disabled={busy}>
            <Fingerprint className="mr-1.5 h-4 w-4" />
            {busy ? t('common.loading') : t('settings.passkeyAdd')}
          </Button>
        </div>
      </Panel>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.passkeyDeleteTitle')}</DialogTitle>
            <DialogDescription>{t('settings.passkeyDeleteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              {t('settings.passkeyDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

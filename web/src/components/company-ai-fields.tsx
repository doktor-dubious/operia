// Konfigurér → Integrationer → AI-labellæser: kundens valg af udbyder (select)
// og model (radio), begrænset til platformens udvalg (Operia → Integrationer).
// Valget gemmes i company_ai_config; selve AI-kaldet sker server-side i edge-
// funktionen ai-read-label, som genchecker udvalget med DCA's egen API-nøgle.
//
// GDPR: labelfotoet indeholder persondata (modtager/afsenders navn, adresse,
// telefon) og sendes til den valgte udbyder — for de fleste uden for EU/EØS,
// for Mistral inden i (deraf de to overførsels-sætninger). Kunden er dataansvarlig, DCA
// er databehandler — derfor står oplysningen om HVEM, HVOR og HVAD her, og
// kunden skal aktivt bekræfte den. Bekræftelsen er kundens dokumenterede
// instruks (art. 28) og stemples server-side (trigger stamp_ai_disclosure);
// uden den afviser edge-funktionen aflæsningen med reason 'not_accepted'.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Info, ShieldAlert } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AI_PROVIDERS, aiModelsFor, aiProvider } from '@/lib/ai'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

type Form = { provider: string; model: string; matchEnabled: boolean; accepted: boolean }
const EMPTY: Form = { provider: '', model: '', matchEnabled: true, accepted: false }

export function CompanyAiFields({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: platform } = usePlatformSettings()
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  // Bekræftelses-popup'en: afkrydsningen sættes først, når kunden har set hele
  // oplysningen og trykket bekræft.
  const [confirming, setConfirming] = useState(false)

  const { data, isPending } = useQuery({
    // Egen nøgle, ikke useCompanyAiConfig's: denne skærm henter også
    // bevis-kolonnerne, og to forskellige kolonnesæt under samme nøgle ville
    // betyde, at den første skærm der blev åbnet, bestemte hvad den anden så.
    queryKey: ['company-ai-settings', companyId],
    queryFn: async () => {
      // Den gældende tekstversion hentes fra serveren SAMMEN med rækken — det
      // er den, godkendelsen måles imod og afgives med. En lokal konstant
      // ville drive fra SQL'en ved en ensidig bump, og så kunne et almindeligt
      // gem stille trække en gyldig godkendelse tilbage.
      const [row, version] = await Promise.all([
        supabase
          .from('company_ai_config')
          .select(
            'provider, model, match_enabled, disclosure_accepted, disclosure_version, disclosure_provider, disclosure_accepted_at',
          )
          .eq('company_id', companyId)
          .maybeSingle(),
        supabase.rpc('ai_disclosure_version'),
      ])
      if (row.error) throw row.error
      if (version.error) throw version.error
      return { row: row.data, currentVersion: version.data as string }
    },
  })
  const row = data?.row

  // En godkendelse gælder kun den udbyder og den tekstversion den blev givet
  // til. Er en af delene skiftet, står afkrydsningen tom igen — så bliver
  // bekræftelsen et bevidst valg og ikke et levn.
  const acceptedValidFor = (provider: string | null | undefined) =>
    !!row?.disclosure_accepted &&
    row.disclosure_provider === provider &&
    row.disclosure_version === data?.currentVersion
  const acceptedStillValid = acceptedValidFor(row?.provider)

  const initial: Form = row
    ? {
        provider: row.provider ?? '',
        model: row.model ?? '',
        matchEnabled: row.match_enabled,
        accepted: acceptedStillValid,
      }
    : EMPTY

  useEffect(() => {
    setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const allowedProviders = AI_PROVIDERS.filter((p) =>
    (platform?.ai_providers ?? []).includes(p.key),
  )
  const allowedModelsFor = (provider: string) =>
    aiModelsFor(provider).filter((m) => (platform?.ai_models ?? []).includes(m.key))

  const models = allowedModelsFor(form.provider)
  const selectedModel = models.find((m) => m.key === form.model)
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  const provider = aiProvider(form.provider)
  // Oplysningens tre dele: hvem, hvor, hvad. Samles ét sted, så teksten på
  // siden, i popup'en og i scanne-dialogen ikke kan drive fra hinanden.
  const disclosureVars = provider
    ? { vendor: provider.vendor, country: t(`companyAi.country.${provider.country}`) }
    : { vendor: '', country: '' }
  // Overførsel til tredjeland og behandling inden for EU/EØS er ikke det samme
  // juridiske forhold — kunden skal se den sætning der faktisk gælder deres valg.
  const transferKey = provider?.outsideEu ? 'disclosureTransfer' : 'disclosureTransferEu'

  const save = async () => {
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('company_ai_config')
      .upsert(
        {
          company_id: companyId,
          provider: form.provider || null,
          model: form.model || null,
          match_enabled: form.matchEnabled,
          // Herfra kan godkendelsen kun BEVARES (uændret udbyder) eller
          // TRÆKKES TILBAGE. At give den er en handling for sig — se nedenfor.
          disclosure_accepted: form.accepted,
        },
        { onConflict: 'company_id' },
      )
      .select('company_id')
    if (error || !saved?.length) {
      setSaving(false)
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }

    // Selve bekræftelsen afgives med det, kunden fik VIST (udbyder +
    // tekstversion). Serveren afviser, hvis det ikke passer med rækkens
    // aktuelle udbyder eller den gældende tekst — så en godkendelse aldrig kan
    // bæres med over til en anden modtager i et andet land.
    //
    // Gyldigheden måles mod den udbyder der LIGE ER GEMT (form.provider), ikke
    // mod den gamle række: ved udbyderskift + genbekræftelse i samme gem har
    // triggeren netop ryddet godkendelsen, og springes kaldet over her, tror
    // UI'et alt er gemt, mens serveren afviser hvert scan med 'not_accepted'.
    if (form.accepted && !acceptedValidFor(form.provider)) {
      const { error: acceptError } = await supabase.rpc('accept_ai_disclosure', {
        p_company_id: companyId,
        p_provider: form.provider,
        p_version: data?.currentVersion ?? '',
      })
      if (acceptError) {
        setSaving(false)
        toast.error(describeError(acceptError, t))
        queryClient.invalidateQueries({ queryKey: ['company-ai-settings', companyId] })
        queryClient.invalidateQueries({ queryKey: ['company-ai', companyId] })
        return
      }
    }
    setSaving(false)
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-ai-settings', companyId] })
    // …og skærmenes egen (mindre) udgave af samme række.
    queryClient.invalidateQueries({ queryKey: ['company-ai', companyId] })
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  if (allowedProviders.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('companyAi.noneOffered')}</p>
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-foreground-light">{t('companyAi.intro')}</p>

      <div className="rounded-md border p-4">
        <Label className="text-label">{t('companyAi.provider')}</Label>
        {/* Altid kontrolleret ('' = intet valg, placeholder vises) — skift
            mellem undefined og værdi udløser Radix' controlled-advarsel. */}
        <Select
          value={form.provider}
          onValueChange={(v) => {
            // Ny udbyder ⇒ modelvalget hører til den gamle og nulstilles — og
            // det samme gør bekræftelsen: den blev givet til en anden
            // modtager i et andet land. Serveren rydder den også (triggeren),
            // men afkrydsningen skal falde med det samme, så kunden kan se det.
            const first = allowedModelsFor(v)
            setForm((f) => ({
              ...f,
              provider: v,
              model: first.length === 1 ? first[0].key : '',
              accepted: f.accepted && f.provider === v,
            }))
          }}
        >
          <SelectTrigger className="mt-2 w-full">
            <SelectValue placeholder={t('companyAi.providerPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {allowedProviders.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {form.provider && (
        <div className="rounded-md border p-4">
          <Label className="text-label">{t('companyAi.model')}</Label>
          {models.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('companyAi.noModels')}</p>
          ) : (
            <RadioGroup
              className="mt-3 flex flex-col gap-2"
              value={form.model}
              onValueChange={(v) => setForm((f) => ({ ...f, model: v }))}
            >
              {models.map((m) => (
                <label key={m.key} className="flex cursor-pointer items-center gap-3">
                  <RadioGroupItem value={m.key} />
                  <span className="text-[13px] font-[450]">{m.label}</span>
                  {!m.vision && (
                    <span className="text-xs text-muted-foreground">
                      {t('companyAi.noVision')}
                    </span>
                  )}
                </label>
              ))}
            </RadioGroup>
          )}
          {selectedModel && !selectedModel.vision && (
            <p className="mt-3 flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
              <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
              <span>{t('companyAi.noVisionExplainer')}</span>
            </p>
          )}
        </div>
      )}

      {/* Fortolkningslaget (fase 1): rent deterministisk matchning mod
          virksomhedens egne data — ingen ekstra AI-kald, ingen ekstra data ud
          af huset. Vises kun når der er valgt en model, for uden aflæsning er
          der ikke noget at fortolke. */}
      {form.provider && form.model && (
        <label className="flex cursor-pointer items-start gap-3 rounded-md border p-4">
          <Switch
            className="mt-0.5"
            checked={form.matchEnabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, matchEnabled: v }))}
          />
          <span className="flex flex-col gap-1">
            <span className="text-[13px] font-[450]">{t('companyAi.matchTitle')}</span>
            <span className="text-xs text-muted-foreground">{t('companyAi.matchHint')}</span>
          </span>
        </label>
      )}

      {/* Oplysning + bekræftelse. Vises så snart der er valgt en udbyder: det
          er dét valg, der afgør hvem persondataen sendes til. */}
      {provider && (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-muted-foreground" />
            <span className="text-[13px] font-[450]">{t('companyAi.disclosureTitle')}</span>
          </div>
          <p className="text-xs leading-relaxed text-foreground-light">
            {t('companyAi.disclosureBody', disclosureVars)}
          </p>
          <ul className="ml-4 list-disc text-xs leading-relaxed text-foreground-light">
            <li>{t('companyAi.disclosureSent')}</li>
            <li>{t(`companyAi.${transferKey}`, disclosureVars)}</li>
            <li>{t('companyAi.disclosureStorage')}</li>
            <li>{t('companyAi.disclosureLog')}</li>
          </ul>
          <label className="flex cursor-pointer items-start gap-3 border-t pt-3">
            <Checkbox
              className="mt-0.5"
              checked={form.accepted}
              onCheckedChange={(v) => {
                // Til = kunden afgiver en instruks; det skal bekræftes bevidst.
                // Fra = tilbagetrækning, og den skal aldrig stå i vejen.
                if (v === true) setConfirming(true)
                else setForm((f) => ({ ...f, accepted: false }))
              }}
            />
            <span className="flex flex-col gap-1">
              <span className="text-[13px] font-[450]">{t('companyAi.acceptLabel')}</span>
              <span className="text-xs text-muted-foreground">
                {form.accepted && acceptedStillValid && row?.disclosure_accepted_at
                  ? t('companyAi.acceptedOn', {
                      date: new Date(row.disclosure_accepted_at).toLocaleString('da-DK'),
                    })
                  : t('companyAi.acceptHint')}
              </span>
            </span>
          </label>
        </div>
      )}

      {/* Uden bekræftelse er opsætningen gyldig, men aflæsningen slået fra —
          serveren afviser med 'not_accepted'. Sig det, frem for at lade
          knappen forsvinde uforklarligt ude på modtag-siden. */}
      {form.provider && form.model && !form.accepted && (
        <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground-light">
          <Info className="mt-px size-3.5 shrink-0 text-amber-600" />
          <span>{t('companyAi.notAcceptedWarning')}</span>
        </p>
      )}

      {dirty && (
        <div className="flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={() => setForm(initial)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || (!!form.provider && !form.model)}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('companyAi.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('companyAi.confirmBody', disclosureVars)}
            </DialogDescription>
          </DialogHeader>
          <ul className="ml-4 list-disc text-xs leading-relaxed text-foreground-light">
            <li>{t('companyAi.disclosureSent')}</li>
            <li>{t(`companyAi.${transferKey}`, disclosureVars)}</li>
            <li>{t('companyAi.disclosureStorage')}</li>
            <li>{t('companyAi.disclosureLog')}</li>
          </ul>
          <p className="text-xs text-muted-foreground">{t('companyAi.confirmInstruction')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                setForm((f) => ({ ...f, accepted: true }))
                setConfirming(false)
              }}
            >
              {t('companyAi.confirmAccept')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

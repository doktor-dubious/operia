import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { CURRENCY_OPTIONS, currencyLabel } from '@/lib/currencies'
import { LANG_OPTIONS } from '@/lib/languages'
import { supabase } from '@/lib/supabase'

// Operia → Lokalisering: platformens sprogudvalg (platform_settings,
// singleton-række). Understøttede sprog som checkbokse (én pr. linje;
// standardsproget markeret med FieldLabel-boksen og låst — det kan ikke
// fravælges), systemets standardsprog som radiogruppe (kun understøttede
// sprog kan vælges). Gemmes via samme fuldbredde-bjælke som templates-siden.
export const Route = createFileRoute('/_app/operia/localization')({
  component: LocalizationPage,
})

function LocalizationPage() {
  const { t, i18n } = useTranslation()
  const { data, isPending } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [supported, setSupported] = useState<Set<string>>(new Set())
  const [defaultLang, setDefaultLang] = useState('da')
  const [currencies, setCurrencies] = useState<Set<string>>(new Set())
  const [defaultCurrency, setDefaultCurrency] = useState('DKK')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    setSupported(new Set(data.supported_languages))
    setDefaultLang(data.default_language)
    setCurrencies(new Set(data.supported_currencies))
    setDefaultCurrency(data.default_currency)
  }, [data])

  const setKey = (s: Iterable<string>) => [...s].sort().join(',')
  const dirty =
    !!data &&
    (setKey(supported) !== setKey(data.supported_languages) ||
      defaultLang !== data.default_language ||
      setKey(currencies) !== setKey(data.supported_currencies) ||
      defaultCurrency !== data.default_currency)

  const save = async () => {
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({
        // Stabil rækkefølge (som LANG_OPTIONS) uanset klikrækkefølgen
        supported_languages: LANG_OPTIONS.map((l) => l.code).filter((c) => supported.has(c)),
        default_language: defaultLang,
        supported_currencies: CURRENCY_OPTIONS.map((c) => c.code).filter((c) =>
          currencies.has(c),
        ),
        default_currency: defaultCurrency,
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
  }

  const cancel = () => {
    if (!data) return
    setSupported(new Set(data.supported_languages))
    setDefaultLang(data.default_language)
    setCurrencies(new Set(data.supported_currencies))
    setDefaultCurrency(data.default_currency)
  }

  const toggleCurrency = (code: string, on: boolean) => {
    setCurrencies((prev) => {
      const next = new Set(prev)
      if (on) next.add(code)
      else next.delete(code)
      return next
    })
  }

  const toggleSupported = (code: string, on: boolean) => {
    setSupported((prev) => {
      const next = new Set(prev)
      if (on) next.add(code)
      else next.delete(code)
      return next
    })
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">
            {t('operiaLocalization.title')}
          </h1>
          <p className="mt-1 text-sm text-foreground-light">
            {t('operiaLocalization.subtitle')}
          </p>
        </header>

        <div className="flex flex-col gap-8">
          <section className="flex max-w-md flex-col gap-3">
            <div>
              <Label className="text-label">{t('operiaLocalization.supportedTitle')}</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('operiaLocalization.supportedHint')}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {LANG_OPTIONS.map((l) =>
                l.code === defaultLang ? (
                  // Standardsproget: FieldLabel-boksen markerer det, og
                  // checkboksen er låst — standardsproget kan ikke fravælges.
                  <FieldLabel key={l.code} htmlFor={`supported-${l.code}`}>
                    <Field orientation="horizontal">
                      <Checkbox id={`supported-${l.code}`} checked disabled />
                      <FieldContent>
                        <FieldTitle>{l.name}</FieldTitle>
                        <FieldDescription>
                          {t('operiaLocalization.defaultMarker')}
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                ) : (
                  <FieldLabel
                    key={l.code}
                    htmlFor={`supported-${l.code}`}
                    className="px-2.5 py-1.5 font-normal"
                  >
                    <Checkbox
                      id={`supported-${l.code}`}
                      checked={supported.has(l.code)}
                      onCheckedChange={(v) => toggleSupported(l.code, v === true)}
                    />
                    {l.name}
                  </FieldLabel>
                ),
              )}
            </div>
          </section>

          <section className="flex max-w-md flex-col gap-3">
            <div>
              <Label className="text-label">{t('operiaLocalization.defaultTitle')}</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('operiaLocalization.defaultHint')}
              </p>
            </div>
            <RadioGroup value={defaultLang} onValueChange={setDefaultLang} className="gap-2">
              {LANG_OPTIONS.map((l) => (
                <FieldLabel
                  key={l.code}
                  htmlFor={`default-${l.code}`}
                  className="px-2.5 py-1.5 font-normal"
                >
                  <RadioGroupItem
                    value={l.code}
                    id={`default-${l.code}`}
                    disabled={!supported.has(l.code)}
                  />
                  <span className={supported.has(l.code) ? undefined : 'text-muted-foreground'}>
                    {l.name}
                  </span>
                </FieldLabel>
              ))}
            </RadioGroup>
          </section>

          <section className="flex max-w-md flex-col gap-3">
            <div>
              <Label className="text-label">{t('operiaLocalization.supportedCurrenciesTitle')}</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('operiaLocalization.supportedCurrenciesHint')}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {CURRENCY_OPTIONS.map((c) =>
                c.code === defaultCurrency ? (
                  // Standardvalutaen: boks-markering og låst — kan ikke fravælges.
                  <FieldLabel key={c.code} htmlFor={`currency-${c.code}`}>
                    <Field orientation="horizontal">
                      <Checkbox id={`currency-${c.code}`} checked disabled />
                      <FieldContent>
                        <FieldTitle>{currencyLabel(c, i18n.language)}</FieldTitle>
                        <FieldDescription>
                          {t('operiaLocalization.currencyDefaultMarker')}
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                ) : (
                  <FieldLabel
                    key={c.code}
                    htmlFor={`currency-${c.code}`}
                    className="px-2.5 py-1.5 font-normal"
                  >
                    <Checkbox
                      id={`currency-${c.code}`}
                      checked={currencies.has(c.code)}
                      onCheckedChange={(v) => toggleCurrency(c.code, v === true)}
                    />
                    {currencyLabel(c, i18n.language)}
                  </FieldLabel>
                ),
              )}
            </div>
          </section>

          <section className="flex max-w-md flex-col gap-3">
            <div>
              <Label className="text-label">{t('operiaLocalization.defaultCurrencyTitle')}</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('operiaLocalization.defaultCurrencyHint')}
              </p>
            </div>
            <RadioGroup value={defaultCurrency} onValueChange={setDefaultCurrency} className="gap-2">
              {CURRENCY_OPTIONS.map((c) => (
                <FieldLabel
                  key={c.code}
                  htmlFor={`default-currency-${c.code}`}
                  className="px-2.5 py-1.5 font-normal"
                >
                  <RadioGroupItem
                    value={c.code}
                    id={`default-currency-${c.code}`}
                    disabled={!currencies.has(c.code)}
                  />
                  <span className={currencies.has(c.code) ? undefined : 'text-muted-foreground'}>
                    {currencyLabel(c, i18n.language)}
                  </span>
                </FieldLabel>
              ))}
            </RadioGroup>
          </section>
        </div>
      </div>

      {dirty && (
        // Fuld bredde som på templates-siden: bryd ud af indholdskolonnen.
        // Venstre = sekundærmenu (w-52) + gap-8 + main px-6 = 16.5rem.
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
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

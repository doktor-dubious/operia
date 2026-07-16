import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CompanyLocalizationFields,
  type LocalizationValue,
} from '@/components/company-config-fields'
import { OperiaPage } from '@/components/operia-config-page'
import { useCompanyContext } from '@/hooks/use-company-context'
import { CURRENCY_OPTIONS } from '@/lib/currencies'
import { LANG_OPTIONS } from '@/lib/languages'
import { supabase } from '@/lib/supabase'

// Konfigurér → Lokalisering: virksomhedens egen lokalisering — samme felter
// som fanen på Operia → Kunder, men for den aktive virksomhed. Managers kan
// gemme via companies_manager_update-politikken.
export const Route = createFileRoute('/_app/configure/localization')({
  component: LocalizationPage,
})

function useCompanyLocalization(companyId: string | null) {
  return useQuery({
    queryKey: ['company-localization', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('default_language, timezone, supported_languages, supported_currencies, default_currency')
        .eq('id', companyId!)
        .single()
      if (error) throw error
      return data
    },
  })
}

// DB'ens time-type er "HH:MM:SS"; vælgeren bruger "HH:MM".
const toValue = (
  row: NonNullable<ReturnType<typeof useCompanyLocalization>['data']>,
): LocalizationValue => ({
  supportedLangs: new Set(row.supported_languages),
  defaultLang: row.default_language,
  supportedCurrencies: new Set(row.supported_currencies),
  defaultCurrency: row.default_currency,
  timezone: row.timezone,
})

function LocalizationPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useCompanyLocalization(companyId)
  const queryClient = useQueryClient()
  const [value, setValue] = useState<LocalizationValue | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setValue(toValue(data))
  }, [data])

  const setKey = (s: Iterable<string>) => [...s].sort().join(',')
  const initial = data ? toValue(data) : null
  const dirty =
    !!value &&
    !!initial &&
    (setKey(value.supportedLangs) !== setKey(initial.supportedLangs) ||
      value.defaultLang !== initial.defaultLang ||
      setKey(value.supportedCurrencies) !== setKey(initial.supportedCurrencies) ||
      value.defaultCurrency !== initial.defaultCurrency ||
      value.timezone !== initial.timezone)

  const save = async () => {
    if (!value || !companyId) return
    // Spejler DB'ens default-in-supported-constraints, så fejlen er læselig.
    if (!value.supportedLangs.has(value.defaultLang)) {
      toast.error(t('customerDetail.languagesInvalid'))
      return
    }
    if (!value.supportedCurrencies.has(value.defaultCurrency)) {
      toast.error(t('customerDetail.currenciesInvalid'))
      return
    }
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('companies')
      .update({
        default_language: value.defaultLang,
        timezone: value.timezone.trim() || 'Europe/Copenhagen',
        // Stabil rækkefølge (som LANG_OPTIONS) uanset klikrækkefølgen;
        // koder uden for listen (seedet via SQL/import) bevares.
        supported_languages: [
          ...LANG_OPTIONS.map((l) => l.code).filter((c) => value.supportedLangs.has(c)),
          ...[...value.supportedLangs].filter((c) => !LANG_OPTIONS.some((l) => l.code === c)),
        ],
        supported_currencies: [
          ...CURRENCY_OPTIONS.map((c) => c.code).filter((c) => value.supportedCurrencies.has(c)),
          ...[...value.supportedCurrencies].filter(
            (code) => !CURRENCY_OPTIONS.some((c) => c.code === code),
          ),
        ],
        default_currency: value.defaultCurrency,
      })
      .eq('id', companyId)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-localization', companyId] })
  }

  const cancel = () => {
    if (data) setValue(toValue(data))
  }

  if (isPending || !value) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <OperiaPage
        title={t('nav.configureLocalization')}
        subtitle={t('configureConfig.localizationSubtitle')}
      >
        <CompanyLocalizationFields
          idPrefix="cfg"
          value={value}
          onChange={(patch) => setValue((prev) => (prev ? { ...prev, ...patch } : prev))}
        />
      </OperiaPage>

      {dirty && (
        // Fuld bredde: bryd ud af indholdskolonnen (sekundærmenu w-52 + gap-8
        // + main px-6 = 16.5rem til venstre).
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

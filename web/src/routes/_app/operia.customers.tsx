import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  CompanyLocalizationFields,
  CompanyLogoFields,
  cleanupLogos,
} from '@/components/company-config-fields'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { ExpiryDatePicker } from '@/components/expiry-date-picker'
import {
  CompanyAgreementsSection,
  ShippingBillingFields,
  type ShippingBillingValue,
} from '@/components/shipping-billing-fields'
import { CopyButton } from '@/components/copy-button'
import { ProductAppearanceList } from '@/components/product-appearance-fields'
import { CompanyDataTransferFields } from '@/components/company-data-transfer-fields'
import { LogDrainsManager } from '@/components/log-drains/log-drains-manager'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { readEdgeError } from '@/lib/edge'
import { CURRENCY_OPTIONS } from '@/lib/currencies'
import { LANG_OPTIONS, catalogDescription, catalogName } from '@/lib/languages'
import { supabase } from '@/lib/supabase'
import { isValidEmail } from '@/lib/validation'

// Operia → Kunder (DCA-ejet, kun platform-admins). Samme mønster som
// stamdata-siderne (fx skabe): tabel + detaljepanel med gem/annullér-bjælke,
// ugemt-vagt og beskyttet sletning. Panelet administrerer virksomhedens
// produkter og funktioner (entitlements). "+ Opret kunde" kører atomisk via
// create-customer Edge Function (opretter tenant + første admin-bruger).

export const Route = createFileRoute('/_app/operia/customers')({
  component: CustomersPage,
})

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short' })

type Catalog = {
  products: {
    key: string
    name: string
    name_en: string | null
    description: string | null
    description_en: string | null
    sort_order: number
  }[]
  features: {
    key: string
    product_key: string
    name: string
    name_en: string | null
    description: string | null
    description_en: string | null
  }[]
}

function useCatalog() {
  return useQuery<Catalog>({
    queryKey: ['entitlement-catalog'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [products, features] = await Promise.all([
        supabase.from('product_catalog').select('key, name, name_en, description, description_en, sort_order').eq('enabled', true).order('sort_order'),
        supabase.from('feature_catalog').select('key, product_key, name, name_en, description, description_en').eq('enabled', true).order('name'),
      ])
      if (products.error) throw products.error
      if (features.error) throw features.error
      return { products: products.data, features: features.data }
    },
  })
}

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows() {
  return useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select(
          // Én sammenhængende literal — sammensatte strenge mister literal-
          // typen, og så kan supabase-js ikke udlede rækketypen.
          'id, name, registration_no, is_active, created_at, purchasing_email, logo_url, default_language, timezone, supported_languages, supported_currencies, default_currency, shipping_model, shipping_margin_percent, shipping_margin_fixed, shipping_byoc_subscription, shipping_byoc_fee, company_products (product_key, valid_until), company_features (feature_key, valid_until)',
        )
        .order('name')
      if (error) throw error
      return data
    },
  })
}

// Fælles produkt/funktion-vælger (bruges i både detaljepanel og opret-dialog).
// Med expiry-props vises en udløbsdato-vælger ved aktive rækker (panelet);
// uden dem (opret-dialogen) er der kun kontakter.
function EntitlementPicker({
  catalog,
  products,
  features,
  onProductsChange,
  onFeaturesChange,
  productExpiry,
  featureExpiry,
  onProductExpiryChange,
  onFeatureExpiryChange,
}: {
  catalog: Catalog
  products: Set<string>
  features: Set<string>
  onProductsChange: (next: Set<string>) => void
  onFeaturesChange: (next: Set<string>) => void
  productExpiry?: Map<string, string | null>
  featureExpiry?: Map<string, string | null>
  onProductExpiryChange?: (key: string, expiry: string | null) => void
  onFeatureExpiryChange?: (key: string, expiry: string | null) => void
}) {
  const { t, i18n } = useTranslation()

  const toggleProduct = (key: string, on: boolean) => {
    const next = new Set(products)
    const nextFeatures = new Set(features)
    if (on) next.add(key)
    else {
      next.delete(key)
      // Fjern funktioner hvis produkt slås fra — de giver ikke mening uden.
      for (const f of catalog.features) if (f.product_key === key) nextFeatures.delete(f.key)
    }
    onProductsChange(next)
    onFeaturesChange(nextFeatures)
  }

  const toggleFeature = (key: string, on: boolean) => {
    const next = new Set(features)
    if (on) next.add(key)
    else next.delete(key)
    onFeaturesChange(next)
  }

  const enabledFeatures = catalog.features.filter((f) => products.has(f.product_key))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-label">{t('customerDetail.productsLabel')}</Label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => onProductsChange(new Set(catalog.products.map((p) => p.key)))}
          >
            {t('customerDetail.selectAll')}
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {catalog.products.map((p) => (
            <div
              key={p.key}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <label htmlFor={`ent-product-${p.key}`} className="min-w-0 flex-1 cursor-pointer">
                <p className="text-[13px] font-[450]">{catalogName(p, i18n.language)}</p>
                {catalogDescription(p, i18n.language) && (
                  <p className="text-xs text-muted-foreground">
                    {catalogDescription(p, i18n.language)}
                  </p>
                )}
              </label>
              <div className="flex shrink-0 items-center gap-2">
                {productExpiry && onProductExpiryChange && products.has(p.key) && (
                  <ExpiryDatePicker
                    value={productExpiry.get(p.key) ?? null}
                    onChange={(expiry) => onProductExpiryChange(p.key, expiry)}
                  />
                )}
                <Switch
                  id={`ent-product-${p.key}`}
                  checked={products.has(p.key)}
                  onCheckedChange={(v) => toggleProduct(p.key, v)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-label">{t('customerDetail.featuresLabel')}</Label>
        {enabledFeatures.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            {t('customerDetail.pickProduct')}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {enabledFeatures.map((f) => (
              <div
                key={f.key}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <label htmlFor={`ent-feature-${f.key}`} className="min-w-0 flex-1 cursor-pointer">
                  <p className="text-[13px] font-[450]">{catalogName(f, i18n.language)}</p>
                  {catalogDescription(f, i18n.language) && (
                    <p className="text-xs text-muted-foreground">
                      {catalogDescription(f, i18n.language)}
                    </p>
                  )}
                </label>
                <div className="flex shrink-0 items-center gap-2">
                  {featureExpiry && onFeatureExpiryChange && features.has(f.key) && (
                    <ExpiryDatePicker
                      value={featureExpiry.get(f.key) ?? null}
                      onChange={(expiry) => onFeatureExpiryChange(f.key, expiry)}
                    />
                  )}
                  <Switch
                    id={`ent-feature-${f.key}`}
                    checked={features.has(f.key)}
                    onCheckedChange={(v) => toggleFeature(f.key, v)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Én oversættelse fra DB-række til formularfelter, delt af useState-
// initialisering, dirty-sammenligning og annullér, så de tre ikke kan glide
// fra hinanden. DB'ens time-type er "HH:MM:SS"; <input type="time"> "HH:MM".
const toForm = (row: Row) => ({
  name: row.name,
  regNo: row.registration_no ?? '',
  purchEmail: row.purchasing_email ?? '',
  logoUrl: row.logo_url ?? '',
  defaultLang: row.default_language,
  timezone: row.timezone,
  supportedLangs: new Set(row.supported_languages),
  supportedCurrencies: new Set(row.supported_currencies),
  defaultCurrency: row.default_currency,
})

function CustomerDetailPane({
  row,
  catalog,
  onClose,
  onDirtyChange,
  onDeleted,
  refresh,
}: {
  row: Row
  catalog: Catalog
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onDeleted: () => void
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')
  // Aktuelle DB-værdier på formularform — følger med når rækken refetches.
  const form = toForm(row)
  const [name, setName] = useState(form.name)
  const [regNo, setRegNo] = useState(form.regNo)
  const initialProducts = useMemo(
    () => row.company_products.map((p) => p.product_key),
    [row],
  )
  const initialFeatures = useMemo(
    () => row.company_features.map((f) => f.feature_key),
    [row],
  )
  // Udløbsdatoer pr. tildeling (null = uden udløb); dato-delen af timestamptz.
  const initialProductExpiry = useMemo(
    () =>
      new Map(row.company_products.map((p) => [p.product_key, p.valid_until?.slice(0, 10) ?? null])),
    [row],
  )
  const initialFeatureExpiry = useMemo(
    () =>
      new Map(row.company_features.map((f) => [f.feature_key, f.valid_until?.slice(0, 10) ?? null])),
    [row],
  )
  const [products, setProducts] = useState<Set<string>>(new Set(initialProducts))
  const [features, setFeatures] = useState<Set<string>>(new Set(initialFeatures))
  const [productExpiry, setProductExpiry] = useState<Map<string, string | null>>(
    new Map(initialProductExpiry),
  )
  const [featureExpiry, setFeatureExpiry] = useState<Map<string, string | null>>(
    new Map(initialFeatureExpiry),
  )
  const [purchEmail, setPurchEmail] = useState(form.purchEmail)
  const [logoUrl, setLogoUrl] = useState(form.logoUrl)
  const [defaultLang, setDefaultLang] = useState(form.defaultLang)
  const [timezone, setTimezone] = useState(form.timezone)
  const [supportedLangs, setSupportedLangs] = useState<Set<string>>(
    new Set(form.supportedLangs),
  )
  const [supportedCurrencies, setSupportedCurrencies] = useState<Set<string>>(
    new Set(form.supportedCurrencies),
  )
  const [defaultCurrency, setDefaultCurrency] = useState(form.defaultCurrency)
  // Forsendelsesmodel: arver platformens standarder (null = arv, samlet gruppe).
  const { data: platformSettings } = usePlatformSettings()
  const shippingOverridden = row.shipping_model != null
  const effectiveShipping = (): ShippingBillingValue => ({
    model: (row.shipping_model ?? platformSettings?.shipping_model ?? 'margin') as
      | 'margin'
      | 'byoc',
    marginPercent: Number(
      row.shipping_margin_percent ?? platformSettings?.shipping_margin_percent ?? 0,
    ),
    marginFixed: Number(row.shipping_margin_fixed ?? platformSettings?.shipping_margin_fixed ?? 0),
    byocSubscription: Number(
      row.shipping_byoc_subscription ?? platformSettings?.shipping_byoc_subscription ?? 0,
    ),
    byocFee: Number(row.shipping_byoc_fee ?? platformSettings?.shipping_byoc_fee ?? 0),
  })
  const [shipping, setShipping] = useState<ShippingBillingValue | null>(null)
  useEffect(() => {
    if (platformSettings) setShipping(effectiveShipping())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformSettings, row])
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const setKey = (s: Iterable<string>) => [...s].sort().join(',')
  // Tildelinger inkl. udløb — "key:udløb" pr. aktiv nøgle.
  const entKey = (keys: Iterable<string>, expiry: Map<string, string | null>) =>
    [...keys]
      .sort()
      .map((k) => `${k}:${expiry.get(k) ?? ''}`)
      .join(',')
  const companyDirty =
    name !== form.name ||
    regNo !== form.regNo ||
    purchEmail !== form.purchEmail ||
    logoUrl !== form.logoUrl ||
    defaultLang !== form.defaultLang ||
    timezone !== form.timezone ||
    setKey(supportedLangs) !== setKey(form.supportedLangs) ||
    setKey(supportedCurrencies) !== setKey(form.supportedCurrencies) ||
    defaultCurrency !== form.defaultCurrency
  const shippingDirty =
    !!shipping &&
    !!platformSettings &&
    JSON.stringify(shipping) !== JSON.stringify(effectiveShipping())
  const dirty =
    companyDirty ||
    shippingDirty ||
    entKey(products, productExpiry) !== entKey(initialProducts, initialProductExpiry) ||
    entKey(features, featureExpiry) !== entKey(initialFeatures, initialFeatureExpiry)

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const saveAll = async () => {
    const trimmedEmail = purchEmail.trim()
    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      toast.error(t('customerDetail.purchasingEmailInvalid'))
      return
    }
    if (!supportedLangs.has(defaultLang)) {
      toast.error(t('customerDetail.languagesInvalid'))
      return
    }
    // Spejler companies_currency_default-constrainten, så fejlen er læselig.
    if (!supportedCurrencies.has(defaultCurrency)) {
      toast.error(t('customerDetail.currenciesInvalid'))
      return
    }
    setSaving(true)
    const trimmedName = name.trim()
    const trimmedReg = regNo.trim()

    if (companyDirty || shippingDirty) {
      const { data, error } = await supabase
        .from('companies')
        .update({
          // Forsendelsesgruppen bliver kun virksomhedens egen hvis den er
          // ændret (eller allerede var det) — ellers fortsætter arven.
          ...(shipping && (shippingDirty || shippingOverridden)
            ? {
                shipping_model: shipping.model,
                shipping_margin_percent: shipping.marginPercent,
                shipping_margin_fixed: shipping.marginFixed,
                shipping_byoc_subscription: shipping.byocSubscription,
                shipping_byoc_fee: shipping.byocFee,
              }
            : {}),
          name: trimmedName,
          registration_no: trimmedReg || null,
          purchasing_email: trimmedEmail || null,
          logo_url: logoUrl.trim() || null,
          default_language: defaultLang,
          timezone: timezone.trim() || 'Europe/Copenhagen',
          // Stabil rækkefølge (som LANG_OPTIONS) uanset klikrækkefølgen;
          // koder uden for listen (seedet via SQL/import) bevares.
          supported_languages: [
            ...LANG_OPTIONS.map((l) => l.code).filter((c) => supportedLangs.has(c)),
            ...[...supportedLangs].filter((c) => !LANG_OPTIONS.some((l) => l.code === c)),
          ],
          supported_currencies: [
            ...CURRENCY_OPTIONS.map((c) => c.code).filter((c) => supportedCurrencies.has(c)),
            ...[...supportedCurrencies].filter(
              (code) => !CURRENCY_OPTIONS.some((c) => c.code === code),
            ),
          ],
          default_currency: defaultCurrency,
        })
        .eq('id', row.id)
        .select('id')
      if (error || !data?.length) {
        setSaving(false)
        toast.error(error ? describeError(error, t) : t('common.noPermission'))
        return
      }
      // Nu er det gemte logo sandheden — udskiftede uploads kan fjernes.
      void cleanupLogos(row.id, logoUrl.trim() || null)
    }

    // Produkter
    const upsertProducts = [...products].filter(
      (p) =>
        !initialProducts.includes(p) ||
        (productExpiry.get(p) ?? null) !== (initialProductExpiry.get(p) ?? null),
    )
    const removeProducts = initialProducts.filter((p) => !products.has(p))
    if (removeProducts.length) {
      const { error } = await supabase
        .from('company_products')
        .delete()
        .eq('company_id', row.id)
        .in('product_key', removeProducts)
      if (error) return failSave(error)
    }
    if (upsertProducts.length) {
      const { error } = await supabase.from('company_products').upsert(
        upsertProducts.map((product_key) => ({
          company_id: row.id,
          product_key,
          valid_until: productExpiry.get(product_key) ?? null,
        })),
      )
      if (error) return failSave(error)
    }

    // Funktioner (kun for aktive produkter). Kataloget er filtreret til
    // enabled — tildelinger uden katalogrække (funktionen er deaktiveret i
    // kataloget) skal bevares, ikke slettes af et uvedkommende gem.
    const productOf = new Map(catalog.features.map((f) => [f.key, f.product_key]))
    const effective = [...features].filter((f) => {
      const parent = productOf.get(f)
      return parent === undefined || products.has(parent)
    })
    const upsertFeatures = effective.filter(
      (f) =>
        !initialFeatures.includes(f) ||
        (featureExpiry.get(f) ?? null) !== (initialFeatureExpiry.get(f) ?? null),
    )
    const removeFeatures = initialFeatures.filter((f) => !effective.includes(f))
    if (removeFeatures.length) {
      const { error } = await supabase
        .from('company_features')
        .delete()
        .eq('company_id', row.id)
        .in('feature_key', removeFeatures)
      if (error) return failSave(error)
    }
    if (upsertFeatures.length) {
      const { error } = await supabase.from('company_features').upsert(
        upsertFeatures.map((feature_key) => ({
          company_id: row.id,
          feature_key,
          valid_until: featureExpiry.get(feature_key) ?? null,
        })),
      )
      if (error) return failSave(error)
    }

    setSaving(false)
    setName(trimmedName)
    setRegNo(trimmedReg)
    setPurchEmail(trimmedEmail)
    setLogoUrl(logoUrl.trim())
    setTimezone(timezone.trim() || 'Europe/Copenhagen')
    setFeatures(new Set(effective))
    toast.success(t('settings.saved'))
    refresh()
  }

  const failSave = (error: unknown) => {
    setSaving(false)
    console.error('Kunne ikke gemme entitlements:', error)
    toast.error(describeError(error, t))
  }

  const cancel = () => {
    setName(form.name)
    setRegNo(form.regNo)
    setPurchEmail(form.purchEmail)
    setLogoUrl(form.logoUrl)
    setDefaultLang(form.defaultLang)
    setTimezone(form.timezone)
    setSupportedLangs(new Set(form.supportedLangs))
    setSupportedCurrencies(new Set(form.supportedCurrencies))
    setDefaultCurrency(form.defaultCurrency)
    if (platformSettings) setShipping(effectiveShipping())
    setProducts(new Set(initialProducts))
    setFeatures(new Set(initialFeatures))
    setProductExpiry(new Map(initialProductExpiry))
    setFeatureExpiry(new Map(initialFeatureExpiry))
  }

  const setActive = async (is_active: boolean) => {
    const { data, error } = await supabase
      .from('companies')
      .update({ is_active })
      .eq('id', row.id)
      .select('id')
    if (error || !data?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const remove = async () => {
    const { data, error } = await supabase.from('companies').delete().eq('id', row.id).select('id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste sletning')
    }
    void cleanupLogos(row.id, null)
    toast.success(t('customerDetail.deletedToast', { name: row.name }))
    onDeleted()
    refresh()
  }

  const tabs = [
    { key: 'details', label: t('detail.tabDetails') },
    { key: 'products', label: t('customerDetail.tabProducts') },
    { key: 'billing', label: t('customerDetail.tabBilling') },
    { key: 'shipping', label: t('shippingBilling.tabLabel') },
    { key: 'logo', label: t('customerDetail.tabLogo') },
    { key: 'localization', label: t('customerDetail.tabLocalization') },
    { key: 'appearance', label: t('customerDetail.tabAppearance') },
    { key: 'datatransfer', label: t('customerDetail.tabDataTransfer') },
    { key: 'logdrains', label: t('customerDetail.tabLogDrains') },
    { key: 'actions', label: t('detail.tabActions') },
  ]

  return (
    <>
      <DetailTabs tabs={tabs} active={tab} onChange={setTab} onClose={onClose}>
        {tab === 'details' && (
          <div className="flex flex-col gap-5">
            <Field label="ID">
              <div className="relative">
                <Input value={row.id} disabled className="pr-10 font-mono text-xs" />
                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                  <CopyButton value={row.id} label={t('detail.copyId')} />
                </div>
              </div>
            </Field>
            <Field label={t('customerDetail.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('customerDetail.registrationNo')}>
              <Input value={regNo} onChange={(e) => setRegNo(e.target.value)} />
            </Field>
          </div>
        )}
        {tab === 'products' && (
          <div className="flex max-w-2xl flex-col gap-3">
            <p className="text-xs text-muted-foreground">{t('customerDetail.productsHint')}</p>
            <EntitlementPicker
              catalog={catalog}
              products={products}
              features={features}
              onProductsChange={setProducts}
              onFeaturesChange={setFeatures}
              productExpiry={productExpiry}
              featureExpiry={featureExpiry}
              onProductExpiryChange={(key, expiry) =>
                setProductExpiry(new Map(productExpiry).set(key, expiry))
              }
              onFeatureExpiryChange={(key, expiry) =>
                setFeatureExpiry(new Map(featureExpiry).set(key, expiry))
              }
            />
          </div>
        )}
        {tab === 'billing' && (
          <div className="flex flex-col gap-5">
            <Field
              label={`${t('customerDetail.purchasingEmail')} (${t('customerDetail.optional')})`}
            >
              <Input
                type="email"
                value={purchEmail}
                placeholder="indkoeb@firma.dk"
                onChange={(e) => setPurchEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('customerDetail.purchasingEmailHint')}
              </p>
            </Field>
          </div>
        )}
        {tab === 'shipping' && shipping && (
          <div className="flex flex-col gap-8">
            <p className="max-w-2xl text-xs text-muted-foreground">
              {t('shippingBilling.subtitle')}
            </p>
            <ShippingBillingFields
              value={shipping}
              currencyShorthand={
                CURRENCY_OPTIONS.find((c) => c.code === row.default_currency)?.shorthand ?? 'kr.'
              }
              onChange={(patch) => setShipping((prev) => (prev ? { ...prev, ...patch } : prev))}
            />
            {shipping.model === 'byoc' && (
              <CompanyAgreementsSection companyId={row.id} canEdit />
            )}
          </div>
        )}
        {tab === 'logo' && (
          <CompanyLogoFields companyId={row.id} logoUrl={logoUrl} onLogoUrlChange={setLogoUrl} />
        )}
        {tab === 'localization' && (
          <CompanyLocalizationFields
            idPrefix="cust"
            value={{ supportedLangs, defaultLang, supportedCurrencies, defaultCurrency, timezone }}
            onChange={(patch) => {
              if (patch.supportedLangs !== undefined) setSupportedLangs(patch.supportedLangs)
              if (patch.supportedCurrencies !== undefined)
                setSupportedCurrencies(patch.supportedCurrencies)
              if (patch.defaultCurrency !== undefined) setDefaultCurrency(patch.defaultCurrency)
              if (patch.defaultLang !== undefined) setDefaultLang(patch.defaultLang)
              if (patch.timezone !== undefined) setTimezone(patch.timezone)
            }}
          />
        )}
        {tab === 'appearance' && <ProductAppearanceList companyId={row.id} />}
        {tab === 'datatransfer' && <CompanyDataTransferFields companyId={row.id} admin />}
        {tab === 'logdrains' && <LogDrainsManager scope="company" companyId={row.id} />}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">
                  {row.is_active ? t('customerDetail.deactivate') : t('customerDetail.activate')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('customerDetail.deactivateDescription')}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setActive(!row.is_active)}>
                {row.is_active ? t('customerDetail.deactivate') : t('customerDetail.activate')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('customerDetail.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('customerDetail.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('customerDetail.delete')}
              </Button>
            </div>
          </div>
        )}
      </DetailTabs>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={saveAll} disabled={saving || !name.trim()}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('customerDetail.deleteTitle', { name: row.name })}
        description={t('customerDetail.deleteWarning')}
        acknowledgeText={t('customerDetail.deleteAcknowledge')}
        confirmLabel={t('customerDetail.delete')}
        onConfirm={remove}
      />
    </>
  )
}

function NewCustomerDialog({
  open,
  onOpenChange,
  catalog,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  catalog: Catalog
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [invite, setInvite] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [products, setProducts] = useState<Set<string>>(new Set())
  const [features, setFeatures] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setName('')
    setEmail('')
    setInvite(false)
    setPassword('')
    setShowPassword(false)
    setProducts(new Set())
    setFeatures(new Set())
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const create = async () => {
    if (!name.trim() || !email.trim()) return
    setBusy(true)
    const productOf = new Map(catalog.features.map((f) => [f.key, f.product_key]))
    const effectiveFeatures = [...features].filter((f) => products.has(productOf.get(f) ?? ''))
    const { data, error } = await supabase.functions.invoke('create-customer', {
      body: {
        companyName: name.trim(),
        adminEmail: email.trim(),
        sendInvitation: invite,
        password: invite ? undefined : password || undefined,
        products: [...products],
        features: effectiveFeatures,
      },
    })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette kunde:', error)
      toast.error(await readEdgeError(error, t('common.error'), { email_exists: t('common.emailExists') }))
      return
    }
    if (invite && data?.emailSent === false) {
      toast.warning(t('common.emailFailed'))
    } else {
      toast.success(
        invite
          ? t('customerDetail.invitedToast', { name: name.trim(), email: email.trim() })
          : t('customerDetail.createdToast', { name: name.trim() }),
      )
    }
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('customerDetail.newTitle')}</DialogTitle>
        </DialogHeader>
        <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          {t('customerDetail.newIntro')}
        </p>

        <div className="flex flex-col gap-2">
          <Label htmlFor="new-customer-name" className="text-label">
            {t('customerDetail.companyName')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="new-customer-name"
            value={name}
            autoFocus
            placeholder={t('customerDetail.companyNamePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="new-customer-email" className="text-label">
            {t('customerDetail.adminEmail')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="new-customer-email"
            type="email"
            value={email}
            placeholder={t('customerDetail.adminEmailPlaceholder')}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <p className="text-[13px] font-[450]">{t('customerDetail.sendInvitation')}</p>
            <p className="text-xs text-muted-foreground">{t('customerDetail.sendInvitationHint')}</p>
          </div>
          <Switch checked={invite} onCheckedChange={setInvite} />
        </label>

        {!invite && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="new-customer-pw" className="text-label">
                {t('customerDetail.password')}{' '}
                <span className="font-normal text-muted-foreground">
                  ({t('customerDetail.passwordOptional')})
                </span>
              </Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 text-xs"
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? t('common.hide') : t('common.show')}
              </Button>
            </div>
            <Input
              id="new-customer-pw"
              type={showPassword ? 'text' : 'password'}
              value={password}
              placeholder={t('customerDetail.passwordPlaceholder')}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}

        <EntitlementPicker
          catalog={catalog}
          products={products}
          features={features}
          onProductsChange={setProducts}
          onFeaturesChange={setFeatures}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !name.trim() || !email.trim()} onClick={create}>
            {busy ? t('common.loading') : t('customerDetail.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CustomersPage() {
  const { t } = useTranslation()
  const { data, isPending } = useRows()
  const { data: catalog } = useCatalog()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [paneDirty, setPaneDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['customers'] })

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('companies')
      .delete()
      .in('id', ids)
      .select('id')
    if (error) throw error
    if ((deleted?.length ?? 0) !== ids.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste (delvist) sletning')
    }
    ids.forEach((id) => void cleanupLogos(id, null))
    if (activeId && ids.includes(activeId)) setActiveId(null)
    await refresh()
  }

  if (isPending || !catalog) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    { key: 'name', header: t('customersPage.name'), sortable: true, sortValue: (r) => r.name },
    {
      key: 'registration_no',
      header: t('customersPage.registrationNo'),
      sortable: true,
      sortValue: (r) => r.registration_no,
      render: (r) => r.registration_no ?? '—',
    },
    {
      key: 'products',
      header: t('customersPage.products'),
      sortable: true,
      sortValue: (r) => r.company_products.length,
      render: (r) => r.company_products.length,
    },
    {
      key: 'is_active',
      header: t('customersPage.active'),
      sortable: true,
      sortValue: (r) => (r.is_active ? 1 : 0),
      render: (r) => (r.is_active ? t('common.yes') : t('common.no')),
    },
    {
      key: 'created_at',
      header: t('customersPage.created'),
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => dateFormat.format(new Date(r.created_at)),
    },
  ]

  const activeRow = data?.find((row) => row.id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('nav.customers').toLowerCase()}
        searchText={(row) => [row.name, row.registration_no].filter(Boolean).join(' ')}
        storageKey="customers"
        toolbar={
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> {t('common.new')}
          </Button>
        }
        onRowClick={(row) => guarded(() => setActiveId(row.id === activeId ? null : row.id))}
        activeRowId={activeId}
        onDelete={deleteRows}
      />
      {activeRow && (
        <CustomerDetailPane
          key={activeRow.id}
          row={activeRow}
          catalog={catalog}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onDeleted={() => setActiveId(null)}
          refresh={refresh}
        />
      )}
      <NewCustomerDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        catalog={catalog}
        onCreated={refresh}
      />
      <Dialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('unsaved.title')}</DialogTitle>
            <DialogDescription>{t('unsaved.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                pendingAction?.()
                setPendingAction(null)
              }}
            >
              {t('unsaved.discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

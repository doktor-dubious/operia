import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Mail } from 'lucide-react'
import { RequestAccessDialog } from '@/components/request-access-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useCompanyContext } from '@/hooks/use-company-context'
import { catalogDescription, catalogName } from '@/lib/languages'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Konfigurér → Produkter & funktioner: REN LÆSEVISNING af virksomhedens
// produkter og funktioner med udløbsdatoer. Tildelinger er DCA-ejede og
// redigeres kun på Operia → Kunder — også af platform-admins, så der kun er
// ét sted at ændre dem. Viser kun det platformen udbyder (enabled-kataloger).
// Ikke-aktiverede produkter/funktioner vises også — slukkede og skrivebeskyttede
// — med en knap der åbner "Kontakt Operia"-dialogen (RequestAccessDialog).
export const Route = createFileRoute('/_app/configure/products')({
  component: ProductsPage,
})

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium' })

function useEntitlements(companyId: string | null) {
  return useQuery({
    queryKey: ['company-entitlements', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [products, features, companyProducts, companyFeatures] = await Promise.all([
        supabase
          .from('product_catalog')
          .select('key, name, name_en, description, description_en, sort_order')
          .eq('enabled', true)
          .order('sort_order'),
        supabase
          .from('feature_catalog')
          .select('key, product_key, name, name_en, description, description_en')
          .eq('enabled', true)
          .order('name'),
        supabase
          .from('company_products')
          .select('product_key, valid_until')
          .eq('company_id', companyId!),
        supabase
          .from('company_features')
          .select('feature_key, valid_until')
          .eq('company_id', companyId!),
      ])
      if (products.error) throw products.error
      if (features.error) throw features.error
      if (companyProducts.error) throw companyProducts.error
      if (companyFeatures.error) throw companyFeatures.error
      return {
        products: products.data,
        features: features.data,
        granted: new Map(companyProducts.data.map((r) => [r.product_key, r.valid_until])),
        grantedFeatures: new Map(companyFeatures.data.map((r) => [r.feature_key, r.valid_until])),
      }
    },
  })
}

function ExpiryText({ validUntil }: { validUntil: string | null | undefined }) {
  const { t } = useTranslation()
  if (!validUntil) return null
  const date = validUntil.slice(0, 10)
  const expired = date < new Date().toISOString().slice(0, 10)
  return (
    <span className={cn('text-xs', expired ? 'text-destructive' : 'text-muted-foreground')}>
      {t('productsPage.expiresAt', { date: dateFormat.format(new Date(date)) })}
    </span>
  )
}

type RequestTarget = {
  kind: 'product' | 'feature'
  key: string
  name: string
  productName?: string
}

function RequestButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClick}>
      <Mail className="size-3.5" />
      {t('productsPage.requestAccess')}
    </Button>
  )
}

function ProductsPage() {
  const { t, i18n } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useEntitlements(companyId)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [request, setRequest] = useState<RequestTarget | null>(null)

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (isPending || !data || !companyId) return <Skeleton className="h-40 w-full" />

  const grantedProducts = data.products.filter((p) => data.granted.has(p.key))
  // Resten af platformens katalog vises også — slukket og skrivebeskyttet — så
  // kunden kan se hvad Operia ellers tilbyder og bede om at få det åbnet.
  const availableProducts = data.products.filter((p) => !data.granted.has(p.key))

  const renderProduct = (
    p: (typeof data.products)[number],
    productGranted: boolean,
  ) => {
    // Alle produktets funktioner vises: de tildelte som slået til, resten som
    // slukkede med en anmod-knap (kun når selve produktet er aktiveret —
    // ellers er produktet det, der skal bedes om først).
    const productFeatures = data.features.filter((f) => f.product_key === p.key)
    const open = expanded.has(p.key)
    const productName = catalogName(p, i18n.language)
    return (
      <div key={p.key} className={cn('rounded-md border', !productGranted && 'border-dashed')}>
        <div className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className={cn('text-[13px] font-[450]', !productGranted && 'text-muted-foreground')}>
              {productName}
            </p>
            {catalogDescription(p, i18n.language) && (
              <p className="text-xs text-muted-foreground">
                {catalogDescription(p, i18n.language)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {productGranted ? (
              <ExpiryText validUntil={data.granted.get(p.key)} />
            ) : (
              <RequestButton
                onClick={() => setRequest({ kind: 'product', key: p.key, name: productName })}
              />
            )}
            <Switch checked={productGranted} disabled />
            {productFeatures.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => toggleExpanded(p.key)}
              >
                {t('productsPage.features')} ({productFeatures.length})
                <ChevronRight
                  className={cn('size-3.5 transition-transform', open && 'rotate-90')}
                />
              </Button>
            )}
          </div>
        </div>
        {open && (
          <div className="flex flex-col divide-y divide-border border-t border-border bg-muted/30">
            {productFeatures.map((f) => {
              const featureGranted = data.grantedFeatures.has(f.key)
              const featureName = catalogName(f, i18n.language)
              return (
                <div
                  key={f.key}
                  className="flex items-center justify-between gap-3 px-3 py-2 pl-6"
                >
                  <div className="min-w-0">
                    <p className={cn('text-[13px]', !featureGranted && 'text-muted-foreground')}>
                      {featureName}
                    </p>
                    {catalogDescription(f, i18n.language) && (
                      <p className="text-xs text-muted-foreground">
                        {catalogDescription(f, i18n.language)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {featureGranted ? (
                      <ExpiryText validUntil={data.grantedFeatures.get(f.key)} />
                    ) : (
                      productGranted && (
                        <RequestButton
                          onClick={() =>
                            setRequest({
                              kind: 'feature',
                              key: f.key,
                              name: featureName,
                              productName,
                            })
                          }
                        />
                      )
                    )}
                    <Switch checked={featureGranted} disabled />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('productsPage.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">
            {t('productsPage.subtitleCompany')}
          </p>
        </header>

        <p className="mb-5 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          {t('productsPage.readOnly')}
        </p>

        {grantedProducts.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
            {t('productsPage.noneGranted')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {grantedProducts.map((p) => renderProduct(p, true))}
          </div>
        )}

        {availableProducts.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-medium text-foreground">
              {t('productsPage.availableTitle')}
            </h2>
            <p className="mt-1 mb-4 text-xs text-muted-foreground">
              {t('productsPage.availableSubtitle')}
            </p>
            <div className="flex flex-col gap-3">
              {availableProducts.map((p) => renderProduct(p, false))}
            </div>
          </section>
        )}
      </div>

      <RequestAccessDialog
        open={!!request}
        onOpenChange={(open) => {
          if (!open) setRequest(null)
        }}
        target={request}
      />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { catalogDescription, catalogName } from '@/lib/languages'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Operia → Produkter & funktioner: platformens udbud. Kontakter på
// katalogerne (enabled) styrer hvad kunderne overhovedet kan få — fravalgte
// skjules på Konfigurér-siden og lukkes i has_product/has_feature-gatingen.
// Funktioner hører til deres produkt og foldes ud med knappen til højre.
export const Route = createFileRoute('/_app/operia/products')({
  component: ProductsPage,
})

function useCatalogAdmin() {
  return useQuery({
    queryKey: ['catalog-admin'],
    queryFn: async () => {
      const [products, features] = await Promise.all([
        supabase.from('product_catalog').select('key, name, name_en, description, description_en, enabled, sort_order').order('sort_order'),
        supabase.from('feature_catalog').select('key, product_key, name, name_en, description, description_en, enabled').order('name'),
      ])
      if (products.error) throw products.error
      if (features.error) throw features.error
      return { products: products.data, features: features.data }
    },
  })
}

function ProductsPage() {
  const { t, i18n } = useTranslation()
  const { data, isPending } = useCatalogAdmin()
  const queryClient = useQueryClient()
  // key → enabled for begge kataloger; sammenlignes mod data for dirty.
  const [products, setProducts] = useState<Map<string, boolean>>(new Map())
  const [features, setFeatures] = useState<Map<string, boolean>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    setProducts(new Map(data.products.map((p) => [p.key, p.enabled])))
    setFeatures(new Map(data.features.map((f) => [f.key, f.enabled])))
  }, [data])

  const dirty =
    !!data &&
    (data.products.some((p) => products.get(p.key) !== p.enabled) ||
      data.features.some((f) => features.get(f.key) !== f.enabled))

  const save = async () => {
    if (!data) return
    setSaving(true)
    const changedProducts = data.products.filter((p) => products.get(p.key) !== p.enabled)
    const changedFeatures = data.features.filter((f) => features.get(f.key) !== f.enabled)
    for (const p of changedProducts) {
      const { data: saved, error } = await supabase
        .from('product_catalog')
        .update({ enabled: products.get(p.key) })
        .eq('key', p.key)
        .select('key')
      if (error || !saved?.length) {
        setSaving(false)
        toast.error(error ? describeError(error, t) : t('common.noPermission'))
        return
      }
    }
    for (const f of changedFeatures) {
      const { data: saved, error } = await supabase
        .from('feature_catalog')
        .update({ enabled: features.get(f.key) })
        .eq('key', f.key)
        .select('key')
      if (error || !saved?.length) {
        setSaving(false)
        toast.error(error ? describeError(error, t) : t('common.noPermission'))
        return
      }
    }
    setSaving(false)
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['catalog-admin'] })
    queryClient.invalidateQueries({ queryKey: ['entitlement-catalog'] })
  }

  const cancel = () => {
    if (!data) return
    setProducts(new Map(data.products.map((p) => [p.key, p.enabled])))
    setFeatures(new Map(data.features.map((f) => [f.key, f.enabled])))
  }

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  if (isPending || !data) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('productsPage.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">
            {t('productsPage.subtitlePlatform')}
          </p>
        </header>

        <div className="flex flex-col gap-3">
          {data.products.map((p) => {
            const productFeatures = data.features.filter((f) => f.product_key === p.key)
            const open = expanded.has(p.key)
            return (
              <div key={p.key} className="rounded-md border">
                <div className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-[450]">{catalogName(p, i18n.language)}</p>
                    {catalogDescription(p, i18n.language) && (
                      <p className="text-xs text-muted-foreground">
                        {catalogDescription(p, i18n.language)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Switch
                      checked={products.get(p.key) ?? false}
                      onCheckedChange={(v) => setProducts(new Map(products).set(p.key, v))}
                    />
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
                    {productFeatures.map((f) => (
                      <div key={f.key} className="flex items-center justify-between gap-3 px-3 py-2 pl-6">
                        <div className="min-w-0">
                          <p className="text-[13px]">{catalogName(f, i18n.language)}</p>
                          {catalogDescription(f, i18n.language) && (
                            <p className="text-xs text-muted-foreground">
                              {catalogDescription(f, i18n.language)}
                            </p>
                          )}
                        </div>
                        <Switch
                          checked={features.get(f.key) ?? false}
                          onCheckedChange={(v) => setFeatures(new Map(features).set(f.key, v))}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {dirty && (
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

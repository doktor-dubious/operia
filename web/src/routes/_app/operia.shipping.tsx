import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ShippingBillingFields,
  type ShippingBillingValue,
} from '@/components/shipping-billing-fields'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { CURRENCY_OPTIONS } from '@/lib/currencies'
import { supabase } from '@/lib/supabase'

// Operia → Forsendelse & fakturering: platformens standarder for
// forsendelsesmodellen (margin/BYOC) og satserne. Virksomheder kan override
// på Konfigurér-siden eller kundefanen.
export const Route = createFileRoute('/_app/operia/shipping')({
  component: ShippingPage,
})

function ShippingPage() {
  const { t } = useTranslation()
  const { data, isPending } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [value, setValue] = useState<ShippingBillingValue | null>(null)
  const [saving, setSaving] = useState(false)

  const toValue = (row: NonNullable<typeof data>): ShippingBillingValue => ({
    model: row.shipping_model as 'margin' | 'byoc',
    marginPercent: Number(row.shipping_margin_percent),
    marginFixed: Number(row.shipping_margin_fixed),
    byocSubscription: Number(row.shipping_byoc_subscription),
    byocFee: Number(row.shipping_byoc_fee),
  })

  useEffect(() => {
    if (data) setValue(toValue(data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const initial = data ? toValue(data) : null
  const dirty =
    !!value && !!initial && JSON.stringify(value) !== JSON.stringify(initial)

  const currencyShorthand =
    CURRENCY_OPTIONS.find((c) => c.code === data?.default_currency)?.shorthand ?? 'kr.'

  const save = async () => {
    if (!value) return
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({
        shipping_model: value.model,
        shipping_margin_percent: value.marginPercent,
        shipping_margin_fixed: value.marginFixed,
        shipping_byoc_subscription: value.byocSubscription,
        shipping_byoc_fee: value.byocFee,
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
    if (data) setValue(toValue(data))
  }

  if (isPending || !value) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('shippingBilling.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">{t('shippingBilling.subtitle')}</p>
        </header>

        <ShippingBillingFields
          value={value}
          currencyShorthand={currencyShorthand}
          onChange={(patch) => setValue((prev) => (prev ? { ...prev, ...patch } : prev))}
        />

        {value.model === 'byoc' && (
          <p className="mt-5 max-w-2xl rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            {t('shippingBilling.agreementsElsewhereHint')}
          </p>
        )}
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

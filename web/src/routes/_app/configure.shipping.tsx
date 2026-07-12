import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  CompanyAgreementsSection,
  ShippingBillingFields,
  type ShippingBillingValue,
} from '@/components/shipping-billing-fields'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { CURRENCY_OPTIONS } from '@/lib/currencies'
import { supabase } from '@/lib/supabase'

// Konfigurér → Forsendelse & fakturering: virksomhedens forsendelsesmodel.
// Arver platformens standarder (null i companies = arv, sættes som samlet
// gruppe); DCA-ejet beslutning, så managers ser siden som læsevisning.
// Kundens egne fragtaftaler (BYOC) administreres nederst.
export const Route = createFileRoute('/_app/configure/shipping')({
  component: ShippingPage,
})

function useCompanyShipping(companyId: string | null) {
  return useQuery({
    queryKey: ['company-shipping', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select(
          'default_currency, shipping_model, shipping_margin_percent, shipping_margin_fixed, shipping_byoc_subscription, shipping_byoc_fee',
        )
        .eq('id', companyId!)
        .single()
      if (error) throw error
      return data
    },
  })
}

function ShippingPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data: access } = useAccess()
  const { data, isPending } = useCompanyShipping(companyId)
  const { data: platform } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [value, setValue] = useState<ShippingBillingValue | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  // Forsendelsesmodellen er DCA's beslutning — managers ser kun.
  const canEdit = access?.isPlatformAdmin === true

  const overridden = data?.shipping_model != null
  const toValue = (): ShippingBillingValue => ({
    model: (data?.shipping_model ?? platform?.shipping_model ?? 'margin') as 'margin' | 'byoc',
    marginPercent: Number(data?.shipping_margin_percent ?? platform?.shipping_margin_percent ?? 0),
    marginFixed: Number(data?.shipping_margin_fixed ?? platform?.shipping_margin_fixed ?? 0),
    byocSubscription: Number(
      data?.shipping_byoc_subscription ?? platform?.shipping_byoc_subscription ?? 0,
    ),
    byocFee: Number(data?.shipping_byoc_fee ?? platform?.shipping_byoc_fee ?? 0),
  })

  useEffect(() => {
    if (data && platform) setValue(toValue())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, platform])

  const initial = data && platform ? toValue() : null
  const dirty = !!value && !!initial && JSON.stringify(value) !== JSON.stringify(initial)

  const currencyShorthand =
    CURRENCY_OPTIONS.find((c) => c.code === data?.default_currency)?.shorthand ?? 'kr.'

  const save = async () => {
    if (!value || !companyId) return
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('companies')
      .update({
        shipping_model: value.model,
        shipping_margin_percent: value.marginPercent,
        shipping_margin_fixed: value.marginFixed,
        shipping_byoc_subscription: value.byocSubscription,
        shipping_byoc_fee: value.byocFee,
      })
      .eq('id', companyId)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-shipping', companyId] })
  }

  const cancel = () => {
    if (data && platform) setValue(toValue())
  }

  // Nulstil: fjern virksomhedens egne satser → platformens standarder gælder.
  const reset = async () => {
    if (!companyId) return
    const { data: saved, error } = await supabase
      .from('companies')
      .update({
        shipping_model: null,
        shipping_margin_percent: null,
        shipping_margin_fixed: null,
        shipping_byoc_subscription: null,
        shipping_byoc_fee: null,
      })
      .eq('id', companyId)
      .select('id')
    if (error || !saved?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    setResetOpen(false)
    toast.success(t('shippingBilling.resetToast'))
    queryClient.invalidateQueries({ queryKey: ['company-shipping', companyId] })
  }

  if (isPending || !value || !companyId) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('shippingBilling.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">{t('shippingBilling.subtitle')}</p>
        </header>

        {!canEdit && (
          <p className="mb-5 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            {t('shippingBilling.readOnly')}
          </p>
        )}

        {canEdit && (
          <div className="mb-5 flex max-w-2xl items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {overridden
                ? t('configureConfig.templateCustomized')
                : t('configureConfig.templateUsesDefault')}
            </p>
            {overridden && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setResetOpen(true)}
              >
                {t('configureConfig.resetToDefault')}
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-8">
          <ShippingBillingFields
            value={value}
            currencyShorthand={currencyShorthand}
            disabled={!canEdit}
            onChange={(patch) => setValue((prev) => (prev ? { ...prev, ...patch } : prev))}
          />

          {value.model === 'byoc' && (
            <CompanyAgreementsSection companyId={companyId} canEdit={canEdit} />
          )}
        </div>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('shippingBilling.resetTitle')}</DialogTitle>
            <DialogDescription>{t('shippingBilling.resetDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={reset}>
              {t('configureConfig.resetConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dirty && canEdit && (
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

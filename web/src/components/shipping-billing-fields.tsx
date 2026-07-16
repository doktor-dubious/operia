import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field } from '@/components/detail-field'
import { supabase } from '@/lib/supabase'

// Forsendelse & fakturering (prototypens "Shipping & billing") — delt mellem
// Operia-siden (platformens standarder), Konfigurér-siden og kundefanen på
// Operia → Kunder. Marginmodel: Operia ejer fragtaftalen og lægger margin på;
// BYOC: kundens egen aftale, der faktureres abonnement/gebyr for systemet.

export type ShippingBillingValue = {
  model: 'margin' | 'byoc'
  marginPercent: number
  marginFixed: number
  byocSubscription: number
  byocFee: number
}

export function ShippingBillingFields({
  value,
  onChange,
  currencyShorthand,
  disabled,
}: {
  value: ShippingBillingValue
  onChange: (patch: Partial<ShippingBillingValue>) => void
  currencyShorthand: string // kundens (eller platformens) standardvaluta
  disabled?: boolean
}) {
  const { t } = useTranslation()

  const numberField = (
    label: string,
    fieldValue: number,
    apply: (n: number) => void,
  ) => (
    <div className="flex flex-col gap-2">
      <Label className="text-label">{label}</Label>
      <Input
        type="number"
        min={0}
        step="0.01"
        value={fieldValue}
        disabled={disabled}
        onChange={(e) => apply(Math.max(0, Number(e.target.value) || 0))}
      />
    </div>
  )

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Field label={t('shippingBilling.modelLabel')}>
        <Select
          value={value.model}
          disabled={disabled}
          onValueChange={(v) => onChange({ model: v as 'margin' | 'byoc' })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="margin">{t('shippingBilling.modelMargin')}</SelectItem>
            <SelectItem value="byoc">{t('shippingBilling.modelByoc')}</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {value.model === 'margin' ? (
        <>
          <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            {t('shippingBilling.marginHint')}
          </p>
          <div className="grid grid-cols-2 gap-4">
            {numberField(t('shippingBilling.markupPercent'), value.marginPercent, (n) =>
              onChange({ marginPercent: n }),
            )}
            {numberField(
              t('shippingBilling.fixedAmount', { currency: currencyShorthand }),
              value.marginFixed,
              (n) => onChange({ marginFixed: n }),
            )}
          </div>
        </>
      ) : (
        <>
          <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            {t('shippingBilling.byocHint')}
          </p>
          <div className="grid grid-cols-2 gap-4">
            {numberField(
              t('shippingBilling.subscription', { currency: currencyShorthand }),
              value.byocSubscription,
              (n) => onChange({ byocSubscription: n }),
            )}
            {numberField(
              t('shippingBilling.feePerShipment', { currency: currencyShorthand }),
              value.byocFee,
              (n) => onChange({ byocFee: n }),
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Kundens egne fragtaftaler (BYOC) ────────────────────────────────────────

const PROVIDERS = ['webshipper', 'sendcloud', 'coolrunner', 'shipbook', 'other'] as const

function providerLabel(provider: string, t: (key: string) => string) {
  if (provider === 'other') return t('carrierAgreements.providerOther')
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}

function useCompanyAgreements(companyId: string) {
  return useQuery({
    queryKey: ['company-agreements', companyId],
    queryFn: async () => {
      // api_key kan ikke læses (kolonne-grants) — vælg aldrig '*' her.
      const { data, error } = await supabase
        .from('carrier_agreements')
        .select('id, agreement_type, provider, name, api_user, account_no, has_key, is_active, created_at')
        .eq('company_id', companyId)
        .order('created_at')
      if (error) throw error
      return data
    },
  })
}

export function CompanyAgreementsSection({
  companyId,
  canEdit,
}: {
  companyId: string
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const { data, isPending } = useCompanyAgreements(companyId)
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [replacingId, setReplacingId] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [removeId, setRemoveId] = useState<string | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['company-agreements', companyId] })

  const replaceKey = async (id: string) => {
    if (!newKey.trim()) return
    const { data: saved, error } = await supabase
      .from('carrier_agreements')
      .update({ api_key: newKey.trim() })
      .eq('id', id)
      .select('id')
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    setReplacingId(null)
    setNewKey('')
    toast.success(t('carrierAgreements.keyReplaced'))
    refresh()
  }

  const remove = async (id: string) => {
    const { data: deleted, error } = await supabase
      .from('carrier_agreements')
      .delete()
      .eq('id', id)
      .select('id')
    if (error || !deleted?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    setRemoveId(null)
    toast.success(t('shippingBilling.agreementRemoved'))
    refresh()
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div>
        <Label className="text-label">{t('shippingBilling.agreementsTitle')}</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('shippingBilling.agreementsHint')}
        </p>
      </div>

      {isPending ? null : !data?.length ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          {t('shippingBilling.noAgreements')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((a) => (
            <div key={a.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-[450]">
                    {a.name?.trim() || providerLabel(a.provider, t)}{' '}
                    <span className="font-normal text-muted-foreground">
                      (
                      {a.agreement_type === 'aggregator'
                        ? t('carrierAgreements.typeAggregator')
                        : t('carrierAgreements.typeCarrier')}
                      )
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {providerLabel(a.provider, t)}
                    {a.api_user ? ` · ${a.api_user}` : ''}
                    {' — '}
                    {a.has_key ? `•••• ${t('carrierAgreements.keySet')}` : t('carrierAgreements.noKey')}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setNewKey('')
                        setReplacingId(replacingId === a.id ? null : a.id)
                      }}
                    >
                      <KeyRound className="size-3.5" /> {t('carrierAgreements.replaceKey')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => setRemoveId(a.id)}
                    >
                      <Trash2 className="size-3.5" /> {t('shippingBilling.remove')}
                    </Button>
                  </div>
                )}
              </div>
              {replacingId === a.id && (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="password"
                    value={newKey}
                    placeholder={t('carrierAgreements.apiKeyPlaceholder')}
                    onChange={(e) => setNewKey(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!newKey.trim()}
                    onClick={() => replaceKey(a.id)}
                  >
                    {t('carrierAgreements.replaceKey')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> {t('common.new')}
        </Button>
      )}

      <AddCompanyAgreementDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        companyId={companyId}
        onCreated={refresh}
      />

      <Dialog open={removeId !== null} onOpenChange={(open) => !open && setRemoveId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('shippingBilling.removeTitle')}</DialogTitle>
            <DialogDescription>{t('carrierAgreements.deleteWarning')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveId(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => removeId && remove(removeId)}>
              {t('shippingBilling.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AddCompanyAgreementDialog({
  open,
  onOpenChange,
  companyId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [type, setType] = useState<'aggregator' | 'carrier'>('aggregator')
  const [provider, setProvider] = useState<string>('other')
  const [name, setName] = useState('')
  const [apiUser, setApiUser] = useState('')
  const [accountNo, setAccountNo] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setType('aggregator')
      setProvider('other')
      setName('')
      setApiUser('')
      setAccountNo('')
      setApiKey('')
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!apiKey.trim()) return
    setBusy(true)
    const { data, error } = await supabase
      .from('carrier_agreements')
      .insert({
        company_id: companyId,
        agreement_type: type,
        provider,
        name: name.trim() || null,
        api_user: apiUser.trim() || null,
        account_no: accountNo.trim() || null,
        api_key: apiKey.trim(),
      })
      .select('id')
    setBusy(false)
    if (error || !data?.length) {
      console.error('Kunne ikke oprette aftale:', error)
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('carrierAgreements.createdToast'))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('carrierAgreements.newTitle')}</DialogTitle>
          <DialogDescription>{t('shippingBilling.agreementsHint')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('carrierAgreements.typeLabel')}</Label>
            <Select value={type} onValueChange={(v) => setType(v as 'aggregator' | 'carrier')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aggregator">{t('carrierAgreements.typeAggregator')}</SelectItem>
                <SelectItem value="carrier">{t('carrierAgreements.typeCarrier')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('carrierAgreements.provider')}</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {providerLabel(p, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-label">
              {t('carrierAgreements.name')}{' '}
              <span className="font-normal text-muted-foreground">
                ({t('customerDetail.optional')})
              </span>
            </Label>
            <Input
              value={name}
              placeholder={t('carrierAgreements.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-label">
              {t('carrierAgreements.apiUser')}{' '}
              <span className="font-normal text-muted-foreground">
                ({t('customerDetail.optional')})
              </span>
            </Label>
            <Input value={apiUser} onChange={(e) => setApiUser(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-label">
            {t('carrierAgreements.accountNo')}{' '}
            <span className="font-normal text-muted-foreground">
              ({t('customerDetail.optional')})
            </span>
          </Label>
          <Input value={accountNo} onChange={(e) => setAccountNo(e.target.value)} />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('carrierAgreements.apiKey')}</Label>
          <Input
            type="password"
            value={apiKey}
            placeholder={t('carrierAgreements.apiKeyPlaceholder')}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !apiKey.trim()} onClick={create}>
            {busy ? t('common.loading') : t('carrierAgreements.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { AssetLookupCard } from '@/components/asset-lookup-card'
import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { LoanTtlSelect } from '@/components/loan-ttl-select'
import { useCompanyContext } from '@/hooks/use-company-context'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import {
  assetCode,
  assetRpcErrorKey,
  findAssetsByCode,
  invalidateAssetQueries,
  type AssetHit,
} from '@/lib/asset-lookup'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { isValidEmail } from '@/lib/validation'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/assets/checkout')({
  component: CheckoutPage,
  // ?code=… forudfylder opslaget (fx fra oversigten eller Søg).
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === 'string' && search.code ? search.code : undefined,
  }),
})

// Tjek ud: aktivet forlader lageret. To udgange, samme skærm:
//  * Tildel — fast tildeling til en medarbejder (status 'assigned'),
//    fx en bærbar til en nyansat. RPC checkout_asset.
//  * Udlån — midlertidigt, med udløb og påmindelser (status 'on_loan').
//    Modtageren vælges fra kartoteket (kontaktdata følger med) eller
//    indtastes frit for eksterne. RPC lend_asset.
// Begge veje gentjekkes server-side og skriver hændelsen i asset_events.

type Mode = 'assign' | 'loan'

function CheckoutPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { companyId } = useCompanyContext()
  const { code } = Route.useSearch()
  const { data: platformSettings } = usePlatformSettings()

  const [asset, setAsset] = useState<AssetHit | null>(null)
  const [mode, setMode] = useState<Mode>('assign')
  const [employee, setEmployee] = useState<PickedEmployee | null>(null)
  const [note, setNote] = useState('')
  // Udlånsfelter (manuelle — bruges når ingen medarbejder er valgt, eller til
  // at overstyre kartotekets kontaktdata).
  const [loanName, setLoanName] = useState('')
  const [loanEmail, setLoanEmail] = useState('')
  const [loanPhone, setLoanPhone] = useState('')
  const [loanAddress, setLoanAddress] = useState('')
  const defaultTtl = platformSettings?.locker_loan_ttl_hours ?? null
  const [ttl, setTtl] = useState<number | null>(defaultTtl)
  const [ttlTouched, setTtlTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  // Platformens standard-udløb kan nå frem efter mount.
  useEffect(() => {
    if (!ttlTouched) setTtl(defaultTtl)
  }, [defaultTtl, ttlTouched])

  const reset = () => {
    setEmployee(null)
    setNote('')
    setLoanName('')
    setLoanEmail('')
    setLoanPhone('')
    setLoanAddress('')
    setTtl(defaultTtl)
    setTtlTouched(false)
  }

  const notInStock = !!asset && (asset.status !== 'in_stock' || !asset.is_active)

  // Udlån: navn fra kartotek eller manuelt; kontakt ligeså. Spejler serverens
  // regler, så knappen ikke lover noget serveren afviser.
  const effectiveName = loanName.trim() || employee?.full_name || ''
  const effectiveEmail = loanEmail.trim() || employee?.email || ''
  const effectivePhone = loanPhone.trim() || employee?.phone || ''
  const emailInvalid = !!effectiveEmail && !isValidEmail(effectiveEmail)
  const hasContact = (!!effectiveEmail && !emailInvalid) || !!effectivePhone
  const canSubmit =
    !!asset &&
    !notInStock &&
    !busy &&
    (mode === 'assign' ? !!employee : !!effectiveName && hasContact && !emailInvalid)

  const refreshAsset = async (assetId: string) => {
    if (!companyId || !asset) return
    const hits = await findAssetsByCode(companyId, assetCode(asset) ?? '')
    setAsset(hits.find((h) => h.id === assetId) ?? null)
  }

  const submit = async () => {
    if (!asset || !canSubmit) return
    setBusy(true)
    const { error } =
      mode === 'assign'
        ? await supabase.rpc('checkout_asset', {
            p_asset_id: asset.id,
            p_employee_id: employee!.id,
            p_note: note.trim() || undefined,
          })
        : await supabase.rpc('lend_asset', {
            p_asset_id: asset.id,
            p_employee_id: employee?.id ?? undefined,
            p_to_name: loanName.trim() || undefined,
            p_to_address: loanAddress.trim() || undefined,
            p_to_email: loanEmail.trim() || undefined,
            p_to_phone: loanPhone.trim() || undefined,
            p_ttl_hours: ttl ?? undefined,
            p_note: note.trim() || undefined,
          })
    setBusy(false)
    if (error) {
      console.error('Tjek ud fejlede:', error)
      const key = assetRpcErrorKey(error)
      toast.error(key ? t(key) : describeError(error, t))
      // Kapløb: status ændrede sig imens — hent den nye frem.
      if (assetRpcErrorKey(error) === 'assetsPage.notInStock') void refreshAsset(asset.id)
      return
    }
    toast.success(
      mode === 'assign'
        ? t('assetFlow.checkedOutToast', { name: asset.name, to: employee!.full_name })
        : t('assetsPage.lentToast', { name: asset.name, to: effectiveName }),
    )
    invalidateAssetQueries(queryClient)
    reset()
    setAsset(null)
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <Card className="w-full max-w-2xl bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('nav.assetCheckout')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AssetLookupCard
            asset={asset}
            onAsset={(a) => {
              setAsset(a)
              reset()
            }}
            initialCode={code}
          />

          {notInStock && (
            <p className="text-xs text-status-neutral-to-bad">{t('assetFlow.checkoutNotInStock')}</p>
          )}

          {asset && !notInStock && (
            <>
              {/* Tildel eller udlån — to knapper som segmentvælger. */}
              <div className="flex gap-2">
                {(['assign', 'loan'] as const).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={mode === m ? 'default' : 'outline'}
                    onClick={() => setMode(m)}
                  >
                    {t(m === 'assign' ? 'assetFlow.modeAssign' : 'assetFlow.modeLoan')}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t(mode === 'assign' ? 'assetFlow.modeAssignHint' : 'assetFlow.modeLoanHint')}
              </p>

              <div className="flex flex-col gap-2">
                <Label>
                  {t('assetFlow.employee')}
                  {mode === 'assign' && ' *'}
                </Label>
                <EmployeePicker
                  companyId={companyId!}
                  value={employee}
                  // Kartotekets kontaktdata forudfyldes som redigerbare værdier
                  // — et andet nummer/adresse kan angives for netop dette udlån.
                  onChange={(e) => {
                    setEmployee(e)
                    setLoanEmail(e?.email ?? '')
                    setLoanPhone(e?.phone ?? '')
                  }}
                />
                {mode === 'loan' && employee && !employee.email && !employee.phone && (
                  <p className="text-xs text-muted-foreground">{t('assetFlow.loanNoContact')}</p>
                )}
              </div>

              {mode === 'loan' && (
                <>
                  <div className="flex flex-col gap-2">
                    <Label className="text-label">{t('assetsPage.lendExpiry')}</Label>
                    <LoanTtlSelect
                      value={ttl}
                      onChange={(v) => {
                        setTtl(v)
                        setTtlTouched(true)
                      }}
                    />
                    <p className="text-xs text-muted-foreground">{t('assetsPage.lendExpiryHint')}</p>
                  </div>
                  {!employee && (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="loan-name" className="text-label">
                        {t('assetsPage.lendToName')} *
                      </Label>
                      <Input
                        id="loan-name"
                        value={loanName}
                        placeholder={t('assetsPage.lendToNamePlaceholder')}
                        onChange={(e) => setLoanName(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="loan-email" className="text-label">
                        {t('assetsPage.lendToEmail')}
                      </Label>
                      <Input
                        id="loan-email"
                        type="email"
                        value={loanEmail}
                        placeholder={employee?.email ?? undefined}
                        aria-invalid={emailInvalid}
                        onChange={(e) => setLoanEmail(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="loan-phone" className="text-label">
                        {t('assetsPage.lendToSms')}
                      </Label>
                      <Input
                        id="loan-phone"
                        type="tel"
                        value={loanPhone}
                        placeholder={employee?.phone ?? undefined}
                        onChange={(e) => setLoanPhone(e.target.value)}
                      />
                    </div>
                  </div>
                  <p
                    className={cn(
                      'text-xs',
                      emailInvalid || !hasContact
                        ? 'text-destructive'
                        : 'text-muted-foreground',
                    )}
                  >
                    {emailInvalid
                      ? t('assetsPage.lendEmailInvalid')
                      : t('assetsPage.lendContactHint')}
                  </p>
                  {!employee && (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="loan-address" className="text-label">
                        {t('assetsPage.lendToAddress')}
                      </Label>
                      <Textarea
                        id="loan-address"
                        value={loanAddress}
                        rows={2}
                        placeholder={t('assetsPage.lendToAddressPlaceholder')}
                        onChange={(e) => setLoanAddress(e.target.value)}
                      />
                    </div>
                  )}
                </>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="checkout-note">{t('assetFlow.note')}</Label>
                <Textarea
                  id="checkout-note"
                  value={note}
                  rows={2}
                  placeholder={t('assetFlow.notePlaceholder')}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="flex justify-end">
                <Button type="button" disabled={!canSubmit} onClick={submit}>
                  {busy
                    ? t('common.loading')
                    : t(mode === 'assign' ? 'assetFlow.checkoutConfirm' : 'assetsPage.lendOut')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

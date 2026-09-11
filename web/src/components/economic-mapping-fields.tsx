import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Mapningen fra Operias kladde til e-conomic (EVU-krav C-02): hvilken debitor
// fakturaen stiles til, og hvilket produkt hver linjetype bogføres på.
// Listerne hentes fra kundens eget e-conomic gennem edge-funktionen, så
// numrene aldrig tastes i hånden. Momsen afgøres af produktet i e-conomic.
//
// Ét debitornummer for hele virksomheden er en foreløbig løsning, indtil
// debitorbegrebet findes på bookingen (spørgsmål 3); en kladdes bill_to_ref
// kan overstyre det pr. kladde.

type Row = {
  economic_customer_number: number | null
  economic_product_room: string | null
  economic_product_participants: string | null
  economic_product_service: string | null
  economic_auto_book: boolean
}
type Item = { number: number | string; name: string; price?: number | null }

const NONE = '__none__'

export function EconomicMappingFields({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [customers, setCustomers] = useState<Item[] | null>(null)
  const [products, setProducts] = useState<Item[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const { data } = useQuery({
    queryKey: ['company-accounting-mapping', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_accounting_config')
        .select('economic_customer_number, economic_product_room, economic_product_participants, economic_product_service, economic_auto_book')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as Row | null
    },
  })
  const initial: Row = {
    economic_customer_number: data?.economic_customer_number ?? null,
    economic_product_room: data?.economic_product_room ?? null,
    economic_product_participants: data?.economic_product_participants ?? null,
    economic_product_service: data?.economic_product_service ?? null,
    economic_auto_book: data?.economic_auto_book ?? false,
  }
  const initialKey = JSON.stringify(initial)
  useEffect(() => {
    setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  // Listerne hentes én gang — det er opslag i kundens regnskab, ikke noget
  // der ændrer sig, mens man sidder med skærmen.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [c, p] = await Promise.all([
        supabase.functions.invoke('economic-transfer', { body: { companyId, action: 'customers' } }),
        supabase.functions.invoke('economic-transfer', { body: { companyId, action: 'products' } }),
      ])
      if (cancelled) return
      if (c.error || !c.data?.ok || p.error || !p.data?.ok) {
        setListError(String(c.data?.reason ?? p.data?.reason ?? c.error?.message ?? p.error?.message ?? 'network'))
        return
      }
      setCustomers(c.data.items as Item[])
      setProducts(p.data.items as Item[])
    })()
    return () => {
      cancelled = true
    }
  }, [companyId])

  if (!form) return null
  const set = (patch: Partial<Row>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const dirty = JSON.stringify(form) !== initialKey

  const save = async () => {
    setBusy(true)
    const { data: saved, error } = await supabase
      .from('company_accounting_config')
      .update(form)
      .eq('company_id', companyId)
      .select('company_id')
    setBusy(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    void queryClient.invalidateQueries({ queryKey: ['company-accounting-mapping', companyId] })
  }

  const withCurrent = (items: Item[] | null, current: string | number | null): Item[] => {
    const list = items ?? []
    if (current != null && !list.some((i) => String(i.number) === String(current))) {
      return [{ number: current, name: `#${current}` }, ...list]
    }
    return list
  }

  const productSelect = (key: 'economic_product_room' | 'economic_product_participants' | 'economic_product_service', label: string) => (
    <div className="flex flex-col gap-1.5">
      <Label className="text-label">{label}</Label>
      <Select value={form[key] ?? NONE} onValueChange={(v) => set({ [key]: v === NONE ? null : v } as Partial<Row>)}>
        <SelectTrigger className="w-64"><SelectValue placeholder={t('economicMapping.pick')} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t('economicMapping.notSet')}</SelectItem>
          {withCurrent(products, form[key]).map((p) => (
            <SelectItem key={String(p.number)} value={String(p.number)}>{p.number} · {p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="flex max-w-2xl flex-col gap-4 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-[450]">{t('economicMapping.title')}</span>
        <p className="text-xs text-muted-foreground">{t('economicMapping.intro')}</p>
        {listError && <p className="text-xs text-destructive">{t(`companyAccounting.test_${listError}`, listError)}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-label">{t('economicMapping.customer')}</Label>
        <Select
          value={form.economic_customer_number == null ? NONE : String(form.economic_customer_number)}
          onValueChange={(v) => set({ economic_customer_number: v === NONE ? null : Number(v) })}
        >
          <SelectTrigger className="w-64"><SelectValue placeholder={t('economicMapping.pick')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('economicMapping.notSet')}</SelectItem>
            {withCurrent(customers, form.economic_customer_number).map((c) => (
              <SelectItem key={String(c.number)} value={String(c.number)}>{c.number} · {c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('economicMapping.customerHint')}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        {productSelect('economic_product_room', t('economicMapping.productRoom'))}
        {productSelect('economic_product_participants', t('economicMapping.productParticipants'))}
        {productSelect('economic_product_service', t('economicMapping.productService'))}
      </div>
      <p className="text-xs text-muted-foreground">{t('economicMapping.productHint')}</p>

      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox className="mt-0.5" checked={form.economic_auto_book} onCheckedChange={(v) => set({ economic_auto_book: v === true })} />
        <span>
          <span className="text-[13px] font-[450]">{t('economicMapping.autoBook')}</span>
          <span className="block text-xs text-muted-foreground">{t('economicMapping.autoBookHint')}</span>
        </span>
      </label>

      <div>
        <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? t('common.loading') : t('common.saveChanges')}
        </Button>
      </div>
    </div>
  )
}

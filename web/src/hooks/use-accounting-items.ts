import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { supabase } from '@/lib/supabase'

export type AccountingItem = {
  number: string
  name: string
  /** Momskoden, regnskabssystemet bogfører produktet med. '' = momsfrit; null = kunne ikke slås op. */
  vatCode: string | null
}
export type AccountingItemKind = 'room' | 'participants' | 'service'
export type AccountingItems = {
  items: AccountingItem[]
  /** Mapningens typeprodukt pr. linjetype — det, "standard" i vælgeren står for. */
  defaults: Record<AccountingItemKind, string | null>
}

// Produktlisten fra kundens regnskabssystem — samme liste, som mapningen på
// Integrationer bruger, delt af ydelse, kategori og niveau. Hentes én gang og
// holdes i fem minutter: produkter oprettes ikke, mens man sidder med skærmen.
//
// `error` er ikke en fejl i Operia: regnskabssystemet svarer ikke, eller
// funktionen er ikke deployet. Kalderen falder tilbage på fritekst, så siden
// stadig kan bruges — og siger det.
export function useAccountingItems(companyId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['accounting-items', companyId],
    enabled: !!companyId && enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<AccountingItems> => {
      const { data, error } = await supabase.functions.invoke('economic-transfer', {
        body: { companyId, action: 'products' },
      })
      if (error) throw error
      if (!data?.ok) throw new Error(String(data?.reason ?? 'unavailable'))
      const raw = data.items as { number: string | number; name: string; vatCode?: string | null }[]
      const d = (data.defaults ?? {}) as Partial<Record<AccountingItemKind, string | null>>
      return {
        items: raw.map((i) => ({ number: String(i.number), name: i.name, vatCode: i.vatCode ?? null })),
        defaults: { room: d.room ?? null, participants: d.participants ?? null, service: d.service ?? null },
      }
    },
  })
}

/** "2010 · Forplejning · U25" — momsen med, når den er kendt. */
export function itemLabel(i: AccountingItem, t: TFunction): string {
  const vat = i.vatCode === null ? '' : ` · ${i.vatCode || t('economicMapping.vatNone')}`
  return `${i.number} · ${i.name}${vat}`
}

export const normVat = (v: string | null | undefined) => (v ?? '').trim().toUpperCase()

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { AI_MODELS } from '@/lib/ai'
import type { NotifyChannel } from '@/lib/notify-contact'
import { supabase } from '@/lib/supabase'

// Forbrug (Platform → Kunder → Forbrug): antal sendte e-mails/SMS for kunden
// og beløbet ud fra stykpriserne (Operia → Generelt) — grundlaget for at
// fakturere pr. besked. Kilden er de append-only afsendelseslogger
// parcel_notifications + asset_loan_notifications (kun status='sent';
// "sent" = accepteret af udbyderen). Testsendinger fra status-testdialogen
// (digest_key 'test-…') tælles ikke med.
//
// Dertil AI-labellæsning med ÉN RÆKKE PR. MODEL: modellerne har hver sin
// stykpris, så de kan ikke lægges sammen. Kilden er revisionssporet
// (RPC ai_label_usage → 'ai.label_read' med outcome='ok').

const TIMEFRAMES = ['thisMonth', 'lastMonth', 'thisYear', 'all'] as const
type Timeframe = (typeof TIMEFRAMES)[number]

function timeframeBounds(tf: Timeframe): { from: string | null; to: string | null } {
  const now = new Date()
  switch (tf) {
    case 'thisMonth':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: null }
    case 'lastMonth':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
        to: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
      }
    case 'thisYear':
      return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: null }
    case 'all':
      return { from: null, to: null }
  }
}

async function countSent(
  table: 'parcel_notifications' | 'asset_loan_notifications',
  companyId: string,
  channel: NotifyChannel,
  bounds: { from: string | null; to: string | null },
): Promise<number> {
  let q = supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('channel', channel)
    .eq('status', 'sent')
  if (bounds.from) q = q.gte('created_at', bounds.from)
  if (bounds.to) q = q.lt('created_at', bounds.to)
  // Testsendinger logges kun i parcel_notifications, markeret med digest_key
  // 'test-<ISO>'. NB: et rent .not(...like) ville også smide digest_key=null
  // (SQL: NULL not like → NULL ⇒ filtreret fra), så null tillades eksplicit.
  if (table === 'parcel_notifications') q = q.or('digest_key.is.null,digest_key.not.like.test-%')
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

/**
 * AI-labelaflæsninger pr. model. Grupperingen sker i basen (RPC), så
 * audit-rækkerne ikke skal hentes ud i browseren for at blive talt.
 */
async function countAiReads(
  companyId: string,
  bounds: { from: string | null; to: string | null },
): Promise<{ model: string; reads: number }[]> {
  const { data, error } = await supabase.rpc('ai_label_usage', {
    p_company_id: companyId,
    // Ingen grænse ⇒ udelad argumentet; funktionens default er null ("al tid").
    p_from: bounds.from ?? undefined,
    p_to: bounds.to ?? undefined,
  })
  if (error) throw error
  return data ?? []
}

export function CompanyUsage({ companyId }: { companyId: string }) {
  const { t, i18n } = useTranslation()
  const [timeframe, setTimeframe] = useState<Timeframe>('thisMonth')
  const { data: platform } = usePlatformSettings()

  const { data: counts, isPending } = useQuery({
    queryKey: ['company-usage', companyId, timeframe],
    queryFn: async () => {
      const bounds = timeframeBounds(timeframe)
      const [parcelEmail, parcelSms, parcelTeams, parcelSlack, assetEmail, assetSms, ai] =
        await Promise.all([
          countSent('parcel_notifications', companyId, 'email', bounds),
          countSent('parcel_notifications', companyId, 'sms', bounds),
          // Chat-kanalerne tælles kun på pakkerne: aktiv-påmindelserne sender
          // stadig kun e-mail/SMS. Med i totalen, så antallet af sendte
          // beskeder er sandt — men uden stykpris, for de koster os intet.
          countSent('parcel_notifications', companyId, 'teams', bounds),
          countSent('parcel_notifications', companyId, 'slack', bounds),
          countSent('asset_loan_notifications', companyId, 'email', bounds),
          countSent('asset_loan_notifications', companyId, 'sms', bounds),
          countAiReads(companyId, bounds),
        ])
      return { parcelEmail, parcelSms, parcelTeams, parcelSlack, assetEmail, assetSms, ai }
    },
  })

  const nf = new Intl.NumberFormat(i18n.language)
  const money = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'DKK' })
  // Stykpriser kan have op til 4 decimaler (brøkdele af øre pr. SMS).
  const unitMoney = new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency: 'DKK',
    maximumFractionDigits: 4,
  })

  const emails = (counts?.parcelEmail ?? 0) + (counts?.assetEmail ?? 0)
  const sms = (counts?.parcelSms ?? 0) + (counts?.assetSms ?? 0)
  const chat = (counts?.parcelTeams ?? 0) + (counts?.parcelSlack ?? 0)
  const emailUnit = platform?.cost_per_email ?? 0
  const smsUnit = platform?.cost_per_sms ?? 0
  const emailCost = emails * emailUnit
  const smsCost = sms * smsUnit

  // Én række pr. model, aldrig en samlet "AI"-linje: priserne er forskellige.
  // Modeller uden pris står med 0 — så er forbruget stadig synligt, og det er
  // tydeligt at der mangler en stykpris på Operia → Generelt.
  const modelPrices = (platform?.ai_model_costs ?? {}) as Record<string, number>
  const aiRows = (counts?.ai ?? []).map((r) => {
    const unit = modelPrices[r.model] ?? 0
    return {
      key: r.model,
      // Modeller der senere fjernes fra kataloget skal stadig kunne faktureres,
      // derfor fallback til den rå modelnøgle frem for at skjule rækken.
      label: AI_MODELS.find((m) => m.key === r.model)?.label ?? r.model,
      reads: r.reads,
      unit,
      cost: r.reads * unit,
    }
  })
  const aiReads = aiRows.reduce((sum, r) => sum + r.reads, 0)
  const aiCost = aiRows.reduce((sum, r) => sum + r.cost, 0)

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('usage.subtitle')}</p>
        <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
          <SelectTrigger size="sm" className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {TIMEFRAMES.map((key) => (
              <SelectItem key={key} value={key}>
                {t(`usage.timeframe.${key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-normal">{t('usage.channel')}</th>
                <th className="px-4 py-2 text-right font-normal">{t('usage.count')}</th>
                <th className="px-4 py-2 text-right font-normal">{t('usage.unitCost')}</th>
                <th className="px-4 py-2 text-right font-normal">{t('usage.cost')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="px-4 py-2.5">{t('usage.email')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{nf.format(emails)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {unitMoney.format(emailUnit)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money.format(emailCost)}</td>
              </tr>
              <tr className="border-b">
                <td className="px-4 py-2.5">{t('usage.sms')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{nf.format(sms)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {unitMoney.format(smsUnit)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money.format(smsCost)}</td>
              </tr>
              {/* Chat-beskeder koster os intet, så rækken vises kun når der
                  faktisk er sendt nogen — ellers ville hver kunde have en
                  permanent 0-linje uden indhold. */}
              {chat > 0 && (
                <tr className="border-b">
                  <td className="px-4 py-2.5">{t('usage.chat')}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{nf.format(chat)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {unitMoney.format(0)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money.format(0)}</td>
                </tr>
              )}
              {aiRows.map((r) => (
                <tr key={r.key} className="border-b">
                  <td className="px-4 py-2.5">{t('usage.aiRead', { model: r.label })}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{nf.format(r.reads)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {unitMoney.format(r.unit)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{money.format(r.cost)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="px-4 py-2.5">{t('usage.total')}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {nf.format(emails + sms + chat + aiReads)}
                </td>
                <td className="px-4 py-2.5" />
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {money.format(emailCost + smsCost + aiCost)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>
          {t('usage.breakdown', {
            parcelCount: nf.format((counts?.parcelEmail ?? 0) + (counts?.parcelSms ?? 0)),
            assetCount: nf.format((counts?.assetEmail ?? 0) + (counts?.assetSms ?? 0)),
          })}
        </p>
        <p>{t('usage.notes')}</p>
      </div>
    </div>
  )
}

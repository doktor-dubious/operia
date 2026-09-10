import type { TFunction } from 'i18next'
import type { ReportDoc } from '@/lib/reports/report-render'
import { formatMoney } from '@/lib/booking-services'
import {
  actorLabel,
  amountDelta,
  bookingLabel,
  describeChanges,
  type HistoryRow,
  type Lookups,
} from '@/lib/booking-history'

// Historikken som rapport (EVU-krav D-06). Bygger den fælles ReportDoc, som
// PDF-, Word- og CSV-renderen i lib/reports allerede deler — historikken skal
// se ens ud i alle tre formater, og det gør den kun, hvis indholdet bygges ét
// sted.
//
// Kravet siger "de filtrerede poster i læsbar form". Læsbar betyder her det
// samme som på skærmen: navne i stedet for id'er, og ændringerne som
// "felt: før → efter". Tabellen i en PDF har ikke skærmens plads til flere
// linjer pr. celle, så ændringerne føjes sammen med semikolon — rækkefølgen er
// den samme som i visningen, så en udskrift og en skærm kan lægges ved siden af
// hinanden.

export type HistoryReportOptions = {
  rows: HistoryRow[]
  lookups: Lookups
  company: string
  currency: string
  lang: string
  t: TFunction
  /** Filtrene som de stod, så udskriften kan dokumentere sit eget udsnit. */
  filters: { from?: string; to?: string; actor?: string }
}

const ARROW = '→'

function fmtDateTime(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(lang.startsWith('en') ? 'en-GB' : 'da-DK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Copenhagen',
  }).format(new Date(iso))
}

/** Ændringerne på én linje: "Ressource: A → B; Kursister: 18 → 24". */
function changesText(row: HistoryRow, lk: Lookups, t: TFunction, lang: string): string {
  const changes = describeChanges(row, lk, t, lang)
  if (changes.length === 0) return t('bookingHistory.noFields')
  return changes
    .map((c) => (c.from ? `${c.field}: ${c.from} ${ARROW} ${c.to}` : `${c.field}: ${c.to}`))
    .join('; ')
}

export function buildHistoryReport(opts: HistoryReportOptions): ReportDoc {
  const { rows, lookups, company, currency, lang, t, filters } = opts

  const metaLines: string[] = []
  if (filters.from || filters.to) {
    metaLines.push(
      t('bookingHistory.report.period', {
        from: filters.from || t('bookingHistory.report.open'),
        to: filters.to || t('bookingHistory.report.open'),
      }),
    )
  }
  if (filters.actor) metaLines.push(t('bookingHistory.report.actor', { name: filters.actor }))
  metaLines.push(t('bookingHistory.report.rowCount', { count: rows.length }))
  metaLines.push(t('bookingHistory.report.generated', { date: fmtDateTime(new Date().toISOString(), lang) }))

  // Nøgletal: hvor meget flyttede ændringerne på fakturagrundlaget? Kun de
  // poster der KAN gøres op tæller med — resten har ingen pris endnu, og et
  // tal der lod som om de var nul, ville være forkert.
  const deltas = rows.map(amountDelta).filter((v): v is number => v !== null)
  const net = deltas.reduce((a, b) => a + b, 0)
  const up = deltas.filter((v) => v > 0).reduce((a, b) => a + b, 0)
  const down = deltas.filter((v) => v < 0).reduce((a, b) => a + b, 0)

  return {
    title: t('bookingHistory.report.title'),
    company,
    metaLines,
    footer: t('bookingHistory.report.footer'),
    sections: [
      {
        blocks: [
          {
            kind: 'kpis',
            items: [
              { label: t('bookingHistory.report.kpiChanges'), value: String(rows.length) },
              {
                label: t('bookingHistory.report.kpiPriced'),
                value: String(deltas.length),
              },
              {
                label: t('bookingHistory.report.kpiUp'),
                value: formatMoney(up, currency, lang),
              },
              {
                label: t('bookingHistory.report.kpiDown'),
                value: formatMoney(down, currency, lang),
              },
              { label: t('bookingHistory.report.kpiNet'), value: formatMoney(net, currency, lang) },
            ],
          },
        ],
      },
      {
        heading: t('bookingHistory.report.tableHeading'),
        blocks: [
          {
            kind: 'table',
            columns: [
              t('bookingHistory.when'),
              t('bookingHistory.booking'),
              t('bookingHistory.action'),
              t('bookingHistory.changes'),
              t('bookingHistory.amount'),
              t('bookingHistory.actor'),
            ],
            rows: rows.map((r) => {
              const delta = amountDelta(r)
              return [
                fmtDateTime(r.created_at, lang),
                bookingLabel(r),
                t(`bookingHistory.event.${r.event_type}`, r.event_type),
                changesText(r, lookups, t, lang),
                delta === null
                  ? '—'
                  : `${delta > 0 ? '+' : ''}${formatMoney(delta, currency, lang)}`,
                actorLabel(r.actor_user_id, lookups, t),
              ]
            }),
          },
        ],
      },
    ],
  }
}

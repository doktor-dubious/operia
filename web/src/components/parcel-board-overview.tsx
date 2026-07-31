import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Label, Pie, PieChart, Sector } from 'recharts'
import type { PieSectorShapeProps } from 'recharts'
import { PackageCheck, Trash2, Undo2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { statusColor, statusLabelKey, type ParcelStatus } from '@/components/parcel-status-badge'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'
import {
  OPEN_STATUSES,
  OPEN_STATUS_CHART_COLOR,
  REMOVED_STATUS,
  TERMINAL_STATUSES,
  TERMINAL_WINDOW_HOURS,
} from '@/lib/parcel-board'

// Pakkeoversigtens forside: ÉN cirkel over de aktive pakker plus to kasser over
// det seneste døgns afsluttede. Tanken er at en reception med tusindvis af pakker
// skal kunne se belastningen på et blik og klikke sig ned i præcis én kategori —
// frem for at skulle scrolle gennem alle pakker som kasser (den gamle tavle).
//
// Kun tællinger hentes (head + count), aldrig rækkerne. Derfor er forsiden lige
// billig for 50 og 50.000 pakker; rækkerne hentes først når man har valgt en
// kategori (parcel-status-list.tsx).

const nf = new Intl.NumberFormat('da-DK')

// Hvert lagkagestykke tegnes selv, så det aktive (mus/touch/tastatur — recharts
// sætter isActive) kan træde frem: stykket vokser lidt og får en tynd bue uden
// om sig. Ren markering — farven følger stadig statussen, så man ikke tror det
// er en anden kategori man peger på.
const ACTIVE_GROW = 6
const ACTIVE_ARC_GAP = 8
const ACTIVE_ARC_WIDTH = 8

function activeSectorShape(props: PieSectorShapeProps) {
  const { isActive, outerRadius = 0, ...sector } = props
  if (!isActive) return <Sector {...sector} outerRadius={outerRadius} />
  return (
    <g>
      <Sector {...sector} outerRadius={outerRadius + ACTIVE_GROW} />
      <Sector
        {...sector}
        innerRadius={outerRadius + ACTIVE_ARC_GAP}
        outerRadius={outerRadius + ACTIVE_ARC_GAP + ACTIVE_ARC_WIDTH}
      />
    </g>
  )
}

type Counts = {
  open: Record<string, number>
  terminal: Record<string, number>
  // Fjernede tælles UDEN tidsvindue: kassen skal kun optræde hvis der findes
  // fejlregistreringer, og de forsvinder ikke efter et døgn.
  removed: number
}

function useCounts(companyId: string | null) {
  return useQuery({
    // Nøglen genbruger 'parcel-status-counts', som alle pakkeskærme og
    // realtime-lytteren (use-parcels-realtime) i forvejen invaliderer.
    queryKey: ['parcel-status-counts', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<Counts> => {
      const cutoff = new Date(Date.now() - TERMINAL_WINDOW_HOURS * 3600 * 1000).toISOString()
      const countFor = (status: ParcelStatus, since?: string) => {
        let q = supabase
          .from('parcels')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId!)
          .eq('status', status)
        // Afsluttede tælles på updated_at: det er tidspunktet hvor overgangen
        // skete (delivered_at findes kun for udleverede, ikke for returnerede).
        if (since) q = q.gte('updated_at', since)
        return q
      }
      const results = await Promise.all([
        ...OPEN_STATUSES.map((s) => countFor(s)),
        ...TERMINAL_STATUSES.map((s) => countFor(s, cutoff)),
        countFor(REMOVED_STATUS),
      ])
      const failed = results.find((r) => r.error)
      if (failed?.error) throw failed.error
      const open: Record<string, number> = {}
      const terminal: Record<string, number> = {}
      OPEN_STATUSES.forEach((s, i) => {
        open[s] = results[i].count ?? 0
      })
      TERMINAL_STATUSES.forEach((s, i) => {
        terminal[s] = results[OPEN_STATUSES.length + i].count ?? 0
      })
      return { open, terminal, removed: results[results.length - 1].count ?? 0 }
    },
  })
}

export function ParcelBoardOverview() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const navigate = useNavigate()
  const { data, isPending } = useCounts(companyId)

  const chartConfig: ChartConfig = {
    count: { label: t('board.parcelsLabel') },
    ...Object.fromEntries(
      OPEN_STATUSES.map((s) => [
        s,
        { label: t(statusLabelKey[s]), color: OPEN_STATUS_CHART_COLOR[s] },
      ]),
    ),
  }

  const slices = OPEN_STATUSES.map((status) => ({
    status,
    count: data?.open[status] ?? 0,
    fill: OPEN_STATUS_CHART_COLOR[status],
  }))
  const activeTotal = slices.reduce((sum, s) => sum + s.count, 0)

  // Klik på et lagkagestykke → samme sted som klik i signaturen nedenunder.
  // Recharts giver enten dataobjektet selv eller et sector-objekt med .payload.
  const sliceStatus = (entry: unknown): ParcelStatus | null => {
    const e = entry as { status?: string; payload?: { status?: string } } | null
    const value = e?.status ?? e?.payload?.status
    return value && (OPEN_STATUSES as readonly string[]).includes(value)
      ? (value as ParcelStatus)
      : null
  }

  const terminalIcon = { delivered: PackageCheck, returned: Undo2 } as const

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('board.activeTitle')}</CardTitle>
          <CardDescription>{t('board.activeDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
          {isPending ? (
            <Skeleton className="size-64 shrink-0 rounded-full" />
          ) : activeTotal === 0 ? (
            <p className="w-full py-12 text-center text-[13px] text-muted-foreground">
              {t('board.noActive')}
            </p>
          ) : (
            <ChartContainer config={chartConfig} className="aspect-square h-64 shrink-0">
              <PieChart>
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent nameKey="status" hideLabel />}
                />
                <Pie
                  data={slices}
                  dataKey="count"
                  nameKey="status"
                  innerRadius={64}
                  strokeWidth={2}
                  stroke="var(--panel)"
                  className="cursor-pointer"
                  shape={activeSectorShape}
                  onClick={(entry) => {
                    const status = sliceStatus(entry)
                    if (status) navigate({ to: '/parcels/board', search: { status } })
                  }}
                >
                  {/* Farven kommer fra hver datapost (fill) — ikke fra <Cell>:
                      med Cell-børn tegner recharts ikke selve lagkagestykkerne. */}
                  <Label
                    content={({ viewBox }) => {
                      if (!viewBox || !('cx' in viewBox)) return null
                      const { cx, cy } = viewBox as { cx: number; cy: number }
                      return (
                        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                          <tspan
                            x={cx}
                            y={cy - 4}
                            className="fill-foreground text-2xl font-semibold"
                          >
                            {nf.format(activeTotal)}
                          </tspan>
                          <tspan x={cx} y={cy + 18} className="fill-muted-foreground text-xs">
                            {t('board.activeParcels')}
                          </tspan>
                        </text>
                      )
                    }}
                  />
                </Pie>
              </PieChart>
            </ChartContainer>
          )}

          {/* Signaturen er samtidig navigationen: den bærer farve, navn og antal,
              så cirklens indhold også kan læses og nås med tastaturet. */}
          <ul className="flex w-full flex-1 flex-col gap-0.5">
            {slices.map((slice) => (
              <li key={slice.status}>
                <Link
                  to="/parcels/board"
                  search={{ status: slice.status }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-accent/60"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: slice.fill }}
                  />
                  <span className="truncate">{t(statusLabelKey[slice.status])}</span>
                  <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                    {isPending ? '—' : nf.format(slice.count)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* De afsluttede: kun seneste døgn, ellers ville tallene bare vokse. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {TERMINAL_STATUSES.map((status) => {
          const Icon = terminalIcon[status]
          return (
            <Link
              key={status}
              to="/parcels/board"
              search={{ status, hours: TERMINAL_WINDOW_HOURS }}
              className="flex items-center gap-4 rounded-lg border border-border bg-panel p-4 transition-colors hover:border-foreground/25 hover:bg-accent/40"
            >
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: statusColor[status] }}
              >
                <Icon className="size-5 text-white" />
              </span>
              <div className="flex flex-col">
                <span className="text-[14px] font-medium">{t(statusLabelKey[status])}</span>
                <span className="text-xs text-muted-foreground">{t('board.window24h')}</span>
              </div>
              <span className="ml-auto font-mono text-2xl font-semibold tabular-nums">
                {isPending ? '—' : nf.format(data?.terminal[status] ?? 0)}
              </span>
            </Link>
          )
        })}
      </div>

      {/* Fjernede fejlregistreringer: egen kasse, kun når der er nogen. */}
      {!isPending && (data?.removed ?? 0) > 0 && (
        <Link
          to="/parcels/board"
          search={{ status: REMOVED_STATUS }}
          className="flex items-center gap-4 rounded-lg border border-border bg-panel p-4 transition-colors hover:border-foreground/25 hover:bg-accent/40"
        >
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-md"
            style={{ backgroundColor: statusColor[REMOVED_STATUS] }}
          >
            <Trash2 className="size-5 text-white" />
          </span>
          <div className="flex flex-col">
            <span className="text-[14px] font-medium">{t(statusLabelKey[REMOVED_STATUS])}</span>
            <span className="text-xs text-muted-foreground">{t('board.removedCaption')}</span>
          </div>
          <span className="ml-auto font-mono text-2xl font-semibold tabular-nums">
            {nf.format(data?.removed ?? 0)}
          </span>
        </Link>
      )}
    </div>
  )
}

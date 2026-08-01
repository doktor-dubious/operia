import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Label, Pie, PieChart, Sector } from 'recharts'
import type { PieSectorShapeProps } from 'recharts'
import { Archive, FileX } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { statusColor, statusLabelKey, type AssetStatus } from '@/components/asset-status-badge'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'
import {
  ACTIVE_ASSET_STATUSES,
  ASSET_STATUS_CHART_COLOR,
  RETIRED_STATUS,
  WRITTEN_OFF_STATUS,
} from '@/lib/asset-board'

// Aktivoversigtens forside: ÉN cirkel over de aktive aktiver (på lager /
// tildelt / udlånt / til service) plus en kasse over de udfasede — samme
// mønster som pakkeoversigten. Kun tællinger hentes (head + count); rækkerne
// hentes først når en kategori er valgt (asset-status-list.tsx).

const nf = new Intl.NumberFormat('da-DK')

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
  active: Record<string, number>
  retired: number
  writtenOff: number
  overdue: number
}

function useCounts(companyId: string | null) {
  return useQuery({
    queryKey: ['asset-status-counts', companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<Counts> => {
      const countFor = (status: AssetStatus) =>
        supabase
          .from('assets')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId!)
          .eq('status', status)
      // Undtagelser: forfaldne udlån (åbne lån med overskredet udløb).
      const overdueQ = supabase
        .from('asset_loans')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId!)
        .is('returned_at', null)
        .lt('expires_at', new Date().toISOString())
      const results = await Promise.all([
        ...ACTIVE_ASSET_STATUSES.map((s) => countFor(s)),
        countFor(RETIRED_STATUS),
        countFor(WRITTEN_OFF_STATUS),
        overdueQ,
      ])
      const failed = results.find((r) => r.error)
      if (failed?.error) throw failed.error
      const active: Record<string, number> = {}
      ACTIVE_ASSET_STATUSES.forEach((s, i) => {
        active[s] = results[i].count ?? 0
      })
      return {
        active,
        retired: results[ACTIVE_ASSET_STATUSES.length].count ?? 0,
        writtenOff: results[ACTIVE_ASSET_STATUSES.length + 1].count ?? 0,
        overdue: results[results.length - 1].count ?? 0,
      }
    },
  })
}

export function AssetBoardOverview() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const navigate = useNavigate()
  const { data, isPending } = useCounts(companyId)

  const chartConfig: ChartConfig = {
    count: { label: t('assetBoard.assetsLabel') },
    ...Object.fromEntries(
      ACTIVE_ASSET_STATUSES.map((s) => [
        s,
        { label: t(statusLabelKey[s]), color: ASSET_STATUS_CHART_COLOR[s] },
      ]),
    ),
  }

  const slices = ACTIVE_ASSET_STATUSES.map((status) => ({
    status,
    count: data?.active[status] ?? 0,
    fill: ASSET_STATUS_CHART_COLOR[status],
  }))
  const activeTotal = slices.reduce((sum, s) => sum + s.count, 0)

  const sliceStatus = (entry: unknown): AssetStatus | null => {
    const e = entry as { status?: string; payload?: { status?: string } } | null
    const value = e?.status ?? e?.payload?.status
    return value && (ACTIVE_ASSET_STATUSES as readonly string[]).includes(value)
      ? (value as AssetStatus)
      : null
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('assetBoard.activeTitle')}</CardTitle>
          <CardDescription>{t('assetBoard.activeDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
          {isPending ? (
            <Skeleton className="size-64 shrink-0 rounded-full" />
          ) : activeTotal === 0 ? (
            <p className="w-full py-12 text-center text-[13px] text-muted-foreground">
              {t('assetBoard.noActive')}
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
                    if (status) navigate({ to: '/assets/board', search: { status } })
                  }}
                >
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
                            {t('assetBoard.activeAssets')}
                          </tspan>
                        </text>
                      )
                    }}
                  />
                </Pie>
              </PieChart>
            </ChartContainer>
          )}

          {/* Signaturen er samtidig navigationen. Forfaldne udlån vises som en
              undtagelsesmarkering under udlånt-linjen. */}
          <ul className="flex w-full flex-1 flex-col gap-0.5">
            {slices.map((slice) => (
              <li key={slice.status}>
                <Link
                  to="/assets/board"
                  search={{ status: slice.status }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-accent/60"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: slice.fill }}
                  />
                  <span className="truncate">{t(statusLabelKey[slice.status])}</span>
                  {slice.status === 'on_loan' && (data?.overdue ?? 0) > 0 && (
                    <span className="rounded-[4px] bg-destructive/10 px-1.5 text-xs font-medium text-destructive">
                      {t('assetBoard.overdueCount', { count: data?.overdue ?? 0 })}
                    </span>
                  )}
                  <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                    {isPending ? '—' : nf.format(slice.count)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Udfasede og afskrevne: egne kasser, kun når der er nogen. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {!isPending && (data?.retired ?? 0) > 0 && (
          <Link
            to="/assets/board"
            search={{ status: RETIRED_STATUS }}
            className="flex items-center gap-4 rounded-lg border border-border bg-panel p-4 transition-colors hover:border-foreground/25 hover:bg-accent/40"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: statusColor[RETIRED_STATUS] }}
            >
              <Archive className="size-5 text-white" />
            </span>
            <div className="flex flex-col">
              <span className="text-[14px] font-medium">{t(statusLabelKey[RETIRED_STATUS])}</span>
              <span className="text-xs text-muted-foreground">{t('assetBoard.retiredCaption')}</span>
            </div>
            <span className="ml-auto font-mono text-2xl font-semibold tabular-nums">
              {nf.format(data?.retired ?? 0)}
            </span>
          </Link>
        )}
        {!isPending && (data?.writtenOff ?? 0) > 0 && (
          <Link
            to="/assets/board"
            search={{ status: WRITTEN_OFF_STATUS }}
            className="flex items-center gap-4 rounded-lg border border-border bg-panel p-4 transition-colors hover:border-foreground/25 hover:bg-accent/40"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: statusColor[WRITTEN_OFF_STATUS] }}
            >
              <FileX className="size-5 text-white" />
            </span>
            <div className="flex flex-col">
              <span className="text-[14px] font-medium">
                {t(statusLabelKey[WRITTEN_OFF_STATUS])}
              </span>
              <span className="text-xs text-muted-foreground">
                {t('assetBoard.writtenOffCaption')}
              </span>
            </div>
            <span className="ml-auto font-mono text-2xl font-semibold tabular-nums">
              {nf.format(data?.writtenOff ?? 0)}
            </span>
          </Link>
        )}
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getISOWeek } from 'date-fns'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Label,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts'
import { Package, PackageCheck, Timer, Boxes, TrendingUp, TrendingDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { supabase } from '@/lib/supabase'
import type { ParcelStatus } from '@/components/parcel-status-badge'

// Statistik: ledelsesrettet overblik over pakkeflowet med rigtige diagrammer
// (shadcn charts/recharts) oven på samme klientside-model som dashboardet.
// Én forespørgsel henter de seneste 180 dage, så delta'er kan sammenlignes
// med den foregående periode; alt aggregeres i useMemo. Diagramfarverne er
// --chart-1..5 fra index.css (CVD-valideret palet, fast slot-rækkefølge).
export const Route = createFileRoute('/_app/stats')({
  component: StatsPage,
})

const DAY_MS = 86_400_000
const OVERDUE_DAYS = 3
const FETCH_DAYS = 180

const OPEN_STATUSES = new Set<ParcelStatus>([
  'unassigned',
  'registered',
  'in_storage',
  'in_transit',
  'in_locker',
])

type Row = {
  status: ParcelStatus
  registered_at: string
  delivered_at: string | null
  department: { name: string } | null
}

type Outcome = 'delivered' | 'open' | 'rejected' | 'returned'

const outcomeOf = (status: ParcelStatus): Outcome =>
  status === 'delivered' || status === 'rejected' || status === 'returned' ? status : 'open'

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d
}

// Mandag i pakkens ISO-uge — bruges som nøgle for ekspeditionstids-trenden.
const weekStart = (d: Date) => {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  x.setHours(0, 0, 0, 0)
  return x
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function useStatsData() {
  return useQuery({
    queryKey: ['parcel-stats'],
    queryFn: async () => {
      const since = new Date(Date.now() - FETCH_DAYS * DAY_MS).toISOString()
      const { data, error } = await supabase
        .from('parcels')
        .select('status, registered_at, delivered_at, department:departments (name)')
        .gte('registered_at', since)
        .order('registered_at', { ascending: false })
        .limit(5000)
      if (error) throw error
      return (data ?? []) as unknown as Row[]
    },
  })
}

// KPI-flise efter dashboardets StatTile-mønster, udvidet med delta mod den
// foregående periode (retning × om "op" er godt afgør farven).
function KpiTile({
  icon: Icon,
  label,
  value,
  deltaPct,
  upIsGood,
  sub,
  accent,
  isPending,
}: {
  icon: LucideIcon
  label: string
  value: string
  deltaPct?: number | null
  upIsGood?: boolean
  sub?: string
  accent: string
  isPending: boolean
}) {
  const { t, i18n } = useTranslation()
  const showDelta = deltaPct != null && Number.isFinite(deltaPct)
  const up = (deltaPct ?? 0) >= 0
  const good = upIsGood ? up : !up
  const DeltaIcon = up ? TrendingUp : TrendingDown
  const pctFmt = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 0,
    signDisplay: 'always',
  })
  return (
    <Card className="relative overflow-hidden bg-panel">
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: accent }} />
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
          <Icon className="size-3.5" style={{ color: accent }} />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-2xl font-semibold">{value}</span>
            {showDelta ? (
              <span
                className="flex items-center gap-1 text-xs"
                style={{ color: good ? 'var(--status-good)' : 'var(--status-bad)' }}
              >
                <DeltaIcon className="size-3.5" />
                {pctFmt.format(deltaPct!)}%
                <span className="text-muted-foreground">{t('stats.vsPrev')}</span>
              </span>
            ) : sub ? (
              <span className="text-xs text-muted-foreground">{sub}</span>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ChartCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="bg-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-4">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function StatsPage() {
  const { t, i18n } = useTranslation()
  const { data: rows, isPending } = useStatsData()
  const [rangeDays, setRangeDays] = useState(90)

  const nf = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language])
  const nf1 = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }),
    [i18n.language],
  )
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }),
    [i18n.language],
  )
  const weekdayFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }),
    [i18n.language],
  )

  const model = useMemo(() => {
    const parcels = rows ?? []
    const now = Date.now()
    const rangeStart = startOfDay(now - (rangeDays - 1) * DAY_MS).getTime()
    const prevStart = rangeStart - rangeDays * DAY_MS

    // Dagsserie (modtaget/udleveret) initialiseres, så tomme dage vises som 0.
    const daily = new Map<string, { ts: number; received: number; delivered: number }>()
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = startOfDay(now - i * DAY_MS)
      daily.set(dayKey(d), { ts: d.getTime(), received: 0, delivered: 0 })
    }

    // ISO-ugedag 0=man..6=søn; forekomster tælles så profilen kan vise snit/dag.
    const weekdayTotals = Array.from({ length: 7 }, () => 0)
    const weekdayOccurrences = Array.from({ length: 7 }, () => 0)
    for (let i = 0; i < rangeDays; i++) {
      weekdayOccurrences[(new Date(rangeStart + i * DAY_MS).getDay() + 6) % 7] += 1
    }

    const outcomes: Record<Outcome, number> = { delivered: 0, open: 0, rejected: 0, returned: 0 }
    const deptCounts = new Map<string, number>()
    const leadByWeek = new Map<number, number[]>()

    let received = 0
    let receivedPrev = 0
    let delivered = 0
    let deliveredPrev = 0
    const leadHours: number[] = []
    const leadHoursPrev: number[] = []
    let openNow = 0
    let overdueNow = 0

    for (const p of parcels) {
      const regTs = new Date(p.registered_at).getTime()

      if (OPEN_STATUSES.has(p.status)) {
        openNow += 1
        if (now - regTs >= OVERDUE_DAYS * DAY_MS) overdueNow += 1
      }

      if (regTs >= rangeStart) {
        received += 1
        outcomes[outcomeOf(p.status)] += 1
        weekdayTotals[(new Date(regTs).getDay() + 6) % 7] += 1
        const dept = p.department?.name
        if (dept) deptCounts.set(dept, (deptCounts.get(dept) ?? 0) + 1)
        const bucket = daily.get(dayKey(new Date(regTs)))
        if (bucket) bucket.received += 1
      } else if (regTs >= prevStart) {
        receivedPrev += 1
      }

      if (p.delivered_at) {
        const delTs = new Date(p.delivered_at).getTime()
        const hours = (delTs - regTs) / 3_600_000
        if (delTs >= rangeStart) {
          delivered += 1
          leadHours.push(hours)
          const bucket = daily.get(dayKey(new Date(delTs)))
          if (bucket) bucket.delivered += 1
          const wk = weekStart(new Date(delTs)).getTime()
          if (!leadByWeek.has(wk)) leadByWeek.set(wk, [])
          leadByWeek.get(wk)!.push(hours)
        } else if (delTs >= prevStart) {
          deliveredPrev += 1
          leadHoursPrev.push(hours)
        }
      }
    }

    const pct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null)
    const leadMedian = median(leadHours)
    const leadMedianPrev = median(leadHoursPrev)

    return {
      received,
      delivered,
      openNow,
      overdueNow,
      leadMedian,
      receivedDelta: pct(received, receivedPrev),
      deliveredDelta: pct(delivered, deliveredPrev),
      leadDelta:
        leadMedian != null && leadMedianPrev != null && leadMedianPrev > 0
          ? ((leadMedian - leadMedianPrev) / leadMedianPrev) * 100
          : null,
      dailySeries: [...daily.values()],
      weekdaySeries: weekdayTotals.map((total, i) => ({
        weekday: weekdayFmt.format(new Date(2026, 0, 5 + i)), // 2026-01-05 er en mandag
        avg: weekdayOccurrences[i] > 0 ? total / weekdayOccurrences[i] : 0,
      })),
      outcomeSeries: (Object.keys(outcomes) as Outcome[])
        .filter((key) => outcomes[key] > 0)
        .map((key) => ({ outcome: key, count: outcomes[key], fill: `var(--color-${key})` })),
      deptSeries: [...deptCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      leadTrend: [...leadByWeek.entries()]
        .sort(([a], [b]) => a - b)
        .map(([wk, hours]) => ({
          week: t('stats.weekShort', { week: getISOWeek(new Date(wk)) }),
          hours: median(hours),
        })),
    }
  }, [rows, rangeDays, weekdayFmt, t])

  const flowConfig = {
    received: { label: t('stats.received'), color: 'var(--chart-1)' },
    delivered: { label: t('stats.delivered'), color: 'var(--chart-2)' },
  } satisfies ChartConfig

  const outcomeConfig = {
    count: { label: t('stats.parcels') },
    delivered: { label: t('dashboard.statusDelivered'), color: 'var(--chart-2)' },
    open: { label: t('stats.outcomeOpen'), color: 'var(--chart-1)' },
    rejected: { label: t('dashboard.statusRejected'), color: 'var(--status-neutral-to-bad)' },
    returned: { label: t('dashboard.statusReturned'), color: 'var(--status-bad)' },
  } satisfies ChartConfig

  const weekdayConfig = {
    avg: { label: t('stats.avgPerDay'), color: 'var(--chart-1)' },
  } satisfies ChartConfig

  const deptConfig = {
    count: { label: t('stats.received'), color: 'var(--chart-1)' },
  } satisfies ChartConfig

  const leadConfig = {
    hours: { label: t('stats.leadHours'), color: 'var(--chart-4)' },
  } satisfies ChartConfig

  const rangeSelect = (
    <Select value={String(rangeDays)} onValueChange={(v) => setRangeDays(Number(v))}>
      <SelectTrigger size="sm" className="w-[150px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {[14, 30, 90].map((days) => (
          <SelectItem key={days} value={String(days)}>
            {t('stats.lastDays', { count: days })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Filterrække: én global periode, der styrer alle nøgletal og diagrammer */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('stats.subtitle')}</p>
        {rangeSelect}
      </div>

      {/* Nøgletal med delta mod foregående periode */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          icon={Package}
          label={t('stats.kpiReceived')}
          value={nf.format(model.received)}
          deltaPct={model.receivedDelta}
          upIsGood
          accent="var(--chart-1)"
          isPending={isPending}
        />
        <KpiTile
          icon={PackageCheck}
          label={t('stats.kpiDelivered')}
          value={nf.format(model.delivered)}
          deltaPct={model.deliveredDelta}
          upIsGood
          accent="var(--chart-2)"
          isPending={isPending}
        />
        <KpiTile
          icon={Timer}
          label={t('stats.kpiLeadTime')}
          value={
            model.leadMedian != null ? t('stats.hours', { value: nf1.format(model.leadMedian) }) : '—'
          }
          deltaPct={model.leadDelta}
          upIsGood={false}
          accent="var(--chart-4)"
          isPending={isPending}
        />
        <KpiTile
          icon={Boxes}
          label={t('stats.kpiOpen')}
          value={nf.format(model.openNow)}
          sub={t('stats.overdueNow', { count: model.overdueNow })}
          accent="var(--status-neutral-to-bad)"
          isPending={isPending}
        />
      </div>

      {/* Pakkeflow pr. dag — modtaget vs. udleveret */}
      <ChartCard title={t('stats.flowTitle')} description={t('stats.flowDesc')}>
        {isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ChartContainer config={flowConfig} className="aspect-auto h-64 w-full">
            <AreaChart data={model.dailySeries} margin={{ left: 4, right: 4 }}>
              <defs>
                <linearGradient id="fillReceived" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-received)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-received)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="fillDelivered" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-delivered)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-delivered)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="ts"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={40}
                tickFormatter={(ts: number) => dateFmt.format(new Date(ts))}
              />
              <YAxis tickLine={false} axisLine={false} width={30} allowDecimals={false} />
              <ChartTooltip
                cursor
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      dateFmt.format(new Date(payload?.[0]?.payload?.ts))
                    }
                    indicator="line"
                  />
                }
              />
              <Area
                dataKey="received"
                type="monotone"
                stroke="var(--color-received)"
                strokeWidth={2}
                fill="url(#fillReceived)"
              />
              <Area
                dataKey="delivered"
                type="monotone"
                stroke="var(--color-delivered)"
                strokeWidth={2}
                fill="url(#fillDelivered)"
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Resultatfordeling — donut med totalen i midten */}
        <ChartCard title={t('stats.outcomeTitle')} description={t('stats.outcomeDesc')}>
          {isPending ? (
            <Skeleton className="h-56 w-full" />
          ) : model.received === 0 ? (
            <p className="text-xs text-muted-foreground">{t('dashboard.noData')}</p>
          ) : (
            <ChartContainer config={outcomeConfig} className="mx-auto aspect-auto h-56 w-full">
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="outcome" />} />
                <Pie
                  data={model.outcomeSeries}
                  dataKey="count"
                  nameKey="outcome"
                  innerRadius={58}
                  strokeWidth={2}
                  stroke="var(--panel)"
                >
                  <Label
                    content={({ viewBox }) => {
                      if (!viewBox || !('cx' in viewBox)) return null
                      const { cx, cy } = viewBox as { cx: number; cy: number }
                      return (
                        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                          <tspan x={cx} y={cy - 4} className="fill-foreground text-2xl font-semibold">
                            {nf.format(model.received)}
                          </tspan>
                          <tspan x={cx} y={cy + 16} className="fill-muted-foreground text-xs">
                            {t('stats.parcels')}
                          </tspan>
                        </text>
                      )
                    }}
                  />
                </Pie>
                <ChartLegend content={<ChartLegendContent nameKey="outcome" />} />
              </PieChart>
            </ChartContainer>
          )}
        </ChartCard>

        {/* Ugedagsprofil — gennemsnitligt antal modtagne pr. ugedag */}
        <ChartCard title={t('stats.weekdayTitle')} description={t('stats.weekdayDesc')}>
          {isPending ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <ChartContainer config={weekdayConfig} className="aspect-auto h-56 w-full">
              <BarChart data={model.weekdaySeries}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="weekday" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={30} />
                <ChartTooltip
                  cursor
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <span>
                          {nf1.format(Number(value))}{' '}
                          <span className="text-muted-foreground">{t('stats.avgPerDaySuffix')}</span>
                        </span>
                      )}
                    />
                  }
                />
                <Bar dataKey="avg" fill="var(--color-avg)" radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        {/* Top-afdelinger — vandrette søjler med værdi ved enden */}
        <ChartCard title={t('stats.deptTitle')} description={t('stats.deptDesc')}>
          {isPending ? (
            <Skeleton className="h-56 w-full" />
          ) : model.deptSeries.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('dashboard.noData')}</p>
          ) : (
            <ChartContainer config={deptConfig} className="aspect-auto h-56 w-full">
              <BarChart data={model.deptSeries} layout="vertical" margin={{ right: 24 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" hide />
                <YAxis
                  dataKey="name"
                  type="category"
                  tickLine={false}
                  axisLine={false}
                  width={110}
                  tickFormatter={(name: string) =>
                    name.length > 15 ? `${name.slice(0, 14)}…` : name
                  }
                />
                <ChartTooltip cursor content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  <LabelList dataKey="count" position="right" className="fill-foreground" fontSize={11} />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        {/* Ekspeditionstid — median timer fra modtagelse til udlevering pr. uge */}
        <ChartCard title={t('stats.leadTitle')} description={t('stats.leadDesc')}>
          {isPending ? (
            <Skeleton className="h-56 w-full" />
          ) : model.leadTrend.length < 2 ? (
            <p className="text-xs text-muted-foreground">{t('dashboard.noData')}</p>
          ) : (
            <ChartContainer config={leadConfig} className="aspect-auto h-56 w-full">
              <LineChart data={model.leadTrend} margin={{ left: 4, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={34}
                  tickFormatter={(v: number) => t('stats.hoursTick', { value: v })}
                />
                <ChartTooltip
                  cursor
                  content={
                    <ChartTooltipContent
                      formatter={(value) => t('stats.hours', { value: nf1.format(Number(value)) })}
                    />
                  }
                />
                <Line
                  dataKey="hours"
                  type="monotone"
                  stroke="var(--color-hours)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--panel)' }}
                />
              </LineChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Package, PackageCheck, Clock, UserX, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ParcelStatusBadge,
  statusColor,
  statusLabelKey,
  type ParcelStatus,
} from '@/components/parcel-status-badge'
import { supabase } from '@/lib/supabase'

// Parcel-dashboard (spec §Dashboard): operationelt overblik over pakkeflowet —
// nøgletal, status-/afdelingsfordeling, undtagelseshåndtering, gennemløb og
// den seneste aktivitet fra den immutable parcel_events-log. Al udregning sker
// klientside på et enkelt træk; ved rigtig skala bør nøgletallene flyttes til
// aggregerende RPC'er.
export const Route = createFileRoute('/_app/parcels/dashboard')({
  component: DashboardPage,
})

const OVERDUE_DAYS = 3
const DAY_MS = 86_400_000

const STATUS_ORDER: ParcelStatus[] = [
  'unassigned',
  'registered',
  'in_storage',
  'in_transit',
  'in_locker',
  'delivered',
  'rejected',
  'returned',
]

const OPEN_STATUSES = new Set<ParcelStatus>([
  'unassigned',
  'registered',
  'in_storage',
  'in_transit',
  'in_locker',
])

type ParcelRow = {
  id: string
  barcode: string | null
  status: ParcelStatus
  registered_at: string
  delivered_at: string | null
  department: { name: string } | null
  receiver: { full_name: string } | null
}

type EventRow = {
  id: number
  event_type: string
  to_status: ParcelStatus | null
  created_at: string
  parcel: { barcode: string | null } | null
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function useDashboardData() {
  return useQuery({
    queryKey: ['parcel-dashboard'],
    queryFn: async () => {
      const [parcels, events] = await Promise.all([
        supabase
          .from('parcels')
          .select(
            `id, barcode, status, registered_at, delivered_at,
             department:departments (name),
             receiver:employees (full_name)`,
          )
          .order('registered_at', { ascending: false })
          .limit(1000),
        supabase
          .from('parcel_events')
          .select('id, event_type, to_status, created_at, parcel:parcels (barcode)')
          .order('created_at', { ascending: false })
          .limit(10),
      ])
      if (parcels.error) throw parcels.error
      if (events.error) throw events.error
      return {
        parcels: (parcels.data ?? []) as unknown as ParcelRow[],
        events: (events.data ?? []) as unknown as EventRow[],
      }
    },
  })
}

// Relativ tid via Intl (samme mønster som operia.logs) — respekterer sproget.
function useRelativeTime() {
  const { i18n } = useTranslation()
  return useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
      ['year', 31_536_000],
      ['month', 2_592_000],
      ['day', 86_400],
      ['hour', 3_600],
      ['minute', 60],
    ]
    return (iso: string) => {
      const diff = (new Date(iso).getTime() - Date.now()) / 1000
      for (const [unit, per] of units) {
        if (Math.abs(diff) >= per) return rtf.format(Math.round(diff / per), unit)
      }
      return rtf.format(Math.round(diff), 'second')
    }
  }, [i18n.language])
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  isPending,
}: {
  icon: LucideIcon
  label: string
  value: number
  sub?: string
  accent: string
  isPending: boolean
}) {
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
          <Skeleton className="h-8 w-12" />
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">{value}</span>
            {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SectionCard({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Card className="bg-panel">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function BarRow({
  label,
  count,
  max,
  color,
}: {
  label: string
  count: number
  max: number
  color: string
}) {
  const pct = max > 0 ? Math.max((count / max) * 100, count > 0 ? 4 : 0) : 0
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-24 shrink-0 truncate text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-8 shrink-0 text-right font-medium tabular-nums">{count}</span>
    </div>
  )
}

function DashboardPage() {
  const { t, i18n } = useTranslation()
  const { data, isPending } = useDashboardData()
  const relTime = useRelativeTime()

  const weekdayFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }),
    [i18n.language],
  )

  const model = useMemo(() => {
    const parcels = data?.parcels ?? []
    const now = Date.now()
    const todayKey = dayKey(new Date())

    const statusCounts = new Map<ParcelStatus, number>()
    const deptCounts = new Map<string, number>()
    const throughput = new Map<string, { received: number; delivered: number }>()

    // Sidste 7 dage (ældst → nyest) initialiseres, så tomme dage vises som 0.
    const days: { key: string; label: string }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * DAY_MS)
      const key = dayKey(d)
      days.push({ key, label: weekdayFmt.format(d) })
      throughput.set(key, { received: 0, delivered: 0 })
    }

    let openCount = 0
    let deliveredToday = 0
    const exceptions: {
      id: string
      barcode: string | null
      receiver: string | null
      status: ParcelStatus
      ageDays: number
    }[] = []

    for (const p of parcels) {
      statusCounts.set(p.status, (statusCounts.get(p.status) ?? 0) + 1)

      const rKey = dayKey(new Date(p.registered_at))
      if (throughput.has(rKey)) throughput.get(rKey)!.received += 1
      if (p.delivered_at) {
        const dKey = dayKey(new Date(p.delivered_at))
        if (throughput.has(dKey)) throughput.get(dKey)!.delivered += 1
        if (dKey === todayKey) deliveredToday += 1
      }

      if (OPEN_STATUSES.has(p.status)) {
        openCount += 1
        const dept = p.department?.name ?? t('dashboard.noDepartment')
        deptCounts.set(dept, (deptCounts.get(dept) ?? 0) + 1)
      }

      const ageDays = Math.floor((now - new Date(p.registered_at).getTime()) / DAY_MS)
      const overdue = OPEN_STATUSES.has(p.status) && ageDays >= OVERDUE_DAYS
      if (p.status === 'unassigned' || p.status === 'rejected' || overdue) {
        exceptions.push({
          id: p.id,
          barcode: p.barcode,
          receiver: p.receiver?.full_name ?? null,
          status: p.status,
          ageDays,
        })
      }
    }

    const overdueCount = parcels.filter(
      (p) =>
        OPEN_STATUSES.has(p.status) &&
        Math.floor((now - new Date(p.registered_at).getTime()) / DAY_MS) >= OVERDUE_DAYS,
    ).length

    exceptions.sort((a, b) => b.ageDays - a.ageDays)

    const depts = [...deptCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)

    const maxStatus = Math.max(1, ...STATUS_ORDER.map((s) => statusCounts.get(s) ?? 0))
    const maxDept = Math.max(1, ...depts.map((d) => d.count))
    const throughputDays = days.map((d) => ({ ...d, ...throughput.get(d.key)! }))
    const maxThroughput = Math.max(
      1,
      ...throughputDays.map((d) => Math.max(d.received, d.delivered)),
    )

    return {
      total: parcels.length,
      statusCounts,
      openCount,
      deliveredToday,
      unassignedCount: statusCounts.get('unassigned') ?? 0,
      rejectedCount: statusCounts.get('rejected') ?? 0,
      overdueCount,
      exceptions,
      depts,
      maxStatus,
      maxDept,
      throughputDays,
      maxThroughput,
    }
  }, [data, weekdayFmt, t])

  const viewAll = (
    <Link
      to="/parcels"
      className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      {t('dashboard.viewAll')}
      <ArrowRight className="size-3" />
    </Link>
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Nøgletal */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatTile
          icon={Package}
          label={t('dashboard.openParcels')}
          value={model.openCount}
          sub={t('dashboard.ofTotal', { count: model.total })}
          accent="#13315C"
          isPending={isPending}
        />
        <StatTile
          icon={PackageCheck}
          label={t('dashboard.deliveredToday')}
          value={model.deliveredToday}
          accent="var(--status-good)"
          isPending={isPending}
        />
        <StatTile
          icon={UserX}
          label={t('dashboard.statusUnassigned')}
          value={model.unassignedCount}
          accent="var(--status-bad)"
          isPending={isPending}
        />
        <StatTile
          icon={Clock}
          label={t('dashboard.overdue')}
          value={model.overdueCount}
          sub={t('dashboard.overdueHint', { days: OVERDUE_DAYS })}
          accent="var(--status-neutral-to-bad)"
          isPending={isPending}
        />
        <StatTile
          icon={XCircle}
          label={t('dashboard.statusRejected')}
          value={model.rejectedCount}
          accent="var(--status-neutral-to-bad)"
          isPending={isPending}
        />
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : model.total === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dashboard.noData')}</p>
      ) : (
        <>
          {/* Fordelinger + undtagelser */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <SectionCard title={t('dashboard.statusDistribution')}>
              <div className="flex flex-col gap-2.5">
                {STATUS_ORDER.map((status) => (
                  <BarRow
                    key={status}
                    label={t(statusLabelKey[status])}
                    count={model.statusCounts.get(status) ?? 0}
                    max={model.maxStatus}
                    color={statusColor[status]}
                  />
                ))}
              </div>
            </SectionCard>

            <SectionCard title={t('dashboard.byDepartment')}>
              {model.depts.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('dashboard.noData')}</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {model.depts.map((d) => (
                    <BarRow
                      key={d.name}
                      label={d.name}
                      count={d.count}
                      max={model.maxDept}
                      color="#13315C"
                    />
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title={t('dashboard.exceptions')} action={viewAll}>
              {model.exceptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('dashboard.noExceptions')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {model.exceptions.slice(0, 6).map((ex) => (
                    <li key={ex.id} className="flex items-center justify-between gap-2 py-2 first:pt-0">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs">{ex.barcode ?? '—'}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {ex.receiver ?? t('dashboard.noReceiver')} ·{' '}
                          {t('dashboard.ageDays', { count: ex.ageDays })}
                        </p>
                      </div>
                      <ParcelStatusBadge status={ex.status} />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          {/* Gennemløb + aktivitet */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SectionCard title={t('dashboard.throughput')}>
              <div className="flex items-end justify-between gap-2 pt-2">
                {model.throughputDays.map((d) => (
                  <div key={d.key} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="flex h-28 items-end gap-1">
                      <div
                        className="w-3 rounded-t bg-[#13315C] transition-all"
                        style={{ height: `${(d.received / model.maxThroughput) * 100}%` }}
                        title={`${t('dashboard.received')}: ${d.received}`}
                      />
                      <div
                        className="w-3 rounded-t transition-all"
                        style={{
                          height: `${(d.delivered / model.maxThroughput) * 100}%`,
                          backgroundColor: 'var(--status-good)',
                        }}
                        title={`${t('dashboard.statusDelivered')}: ${d.delivered}`}
                      />
                    </div>
                    <span className="text-[10px] capitalize text-muted-foreground">{d.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-[#13315C]" />
                  {t('dashboard.received')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ backgroundColor: 'var(--status-good)' }} />
                  {t('dashboard.statusDelivered')}
                </span>
              </div>
            </SectionCard>

            <SectionCard title={t('dashboard.recentActivity')}>
              {(data?.events.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">{t('dashboard.noActivity')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {data!.events.map((ev) => (
                    <li key={ev.id} className="flex items-center justify-between gap-3 py-2 first:pt-0">
                      <p className="min-w-0 truncate text-xs">
                        <span className="font-mono">{ev.parcel?.barcode ?? '—'}</span>
                        <span className="text-muted-foreground">
                          {' · '}
                          {t(`dashboard.evt.${ev.event_type}`, {
                            defaultValue: ev.event_type,
                          })}
                          {(ev.event_type === 'created' || ev.event_type === 'status_changed') &&
                            ev.to_status
                            ? ` → ${t(statusLabelKey[ev.to_status])}`
                            : ''}
                        </span>
                      </p>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {relTime(ev.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  )
}

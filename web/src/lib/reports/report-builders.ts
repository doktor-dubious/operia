import type { TFunction } from 'i18next'
import { supabase } from '@/lib/supabase'
import { statusLabelKey, type ParcelStatus } from '@/components/parcel-status-badge'
import type { ReportBlock, ReportDoc, ReportSection } from './report-render'

// Bygger rapportindholdet (ReportDoc) for hver rapporttype ud fra live-data.
// Al aggregering sker klientside på samme måde som dashboard/statistik.

export type ReportKind = 'summary' | 'exceptions' | 'departments' | 'custody'

export type ReportOptions = {
  rangeDays: number
  barcode?: string
  t: TFunction
  lang: string
}

const DAY_MS = 86_400_000
const OVERDUE_DAYS = 3

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
  parcel_type: 'package' | 'pallet' | 'letter'
  is_private: boolean
  sender: string | null
  registered_at: string
  delivered_at: string | null
  delivered_to: string | null
  department: { name: string } | null
  receiver: { full_name: string } | null
  carrier: { name: string } | null
  location: { name: string } | null
}

type EventRow = {
  id: number
  event_type: string
  from_status: ParcelStatus | null
  to_status: ParcelStatus | null
  from_location_id: string | null
  to_location_id: string | null
  actor_user_id: string | null
  created_at: string
}

const PARCEL_SELECT = `id, barcode, status, parcel_type, is_private, sender,
  registered_at, delivered_at, delivered_to,
  department:departments (name),
  receiver:employees (full_name),
  carrier:carriers (name),
  location:storage_locations (name)`

const median = (xs: number[]) => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function fetchParcelsSince(sinceIso: string): Promise<ParcelRow[]> {
  const { data, error } = await supabase
    .from('parcels')
    .select(PARCEL_SELECT)
    .gte('registered_at', sinceIso)
    .order('registered_at', { ascending: false })
    .limit(5000)
  if (error) throw error
  return (data ?? []) as unknown as ParcelRow[]
}

// Firmanavn til rapporthovedet. Platform-admins ser alle virksomheder, så
// navnet bruges kun når konteksten er entydig (præcis én række).
async function fetchCompanyName(): Promise<string> {
  const { data } = await supabase.from('companies').select('name').limit(2)
  return data?.length === 1 ? data[0].name : 'Operia'
}

function makeFormatters(lang: string) {
  return {
    nf: new Intl.NumberFormat(lang),
    nf1: new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }),
    date: new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }),
    dateTime: new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }),
  }
}

export async function buildReport(kind: ReportKind, opts: ReportOptions): Promise<ReportDoc> {
  switch (kind) {
    case 'summary':
      return buildSummary(opts)
    case 'exceptions':
      return buildExceptions(opts)
    case 'departments':
      return buildDepartments(opts)
    case 'custody':
      return buildCustody(opts)
  }
}

function periodMeta(opts: ReportOptions, fmt: ReturnType<typeof makeFormatters>) {
  const to = new Date()
  const from = new Date(Date.now() - (opts.rangeDays - 1) * DAY_MS)
  return opts.t('reports.doc.periodLine', {
    from: fmt.date.format(from),
    to: fmt.date.format(to),
    days: opts.rangeDays,
  })
}

function footerLine(opts: ReportOptions, fmt: ReturnType<typeof makeFormatters>) {
  return opts.t('reports.doc.generatedBy', { date: fmt.dateTime.format(new Date()) })
}

const share = (nf: Intl.NumberFormat, count: number, total: number) =>
  total > 0 ? `${nf.format(Math.round((count / total) * 100))}%` : '—'

// ── Driftsrapport ───────────────────────────────────────────────────────────

async function buildSummary(opts: ReportOptions): Promise<ReportDoc> {
  const { t } = opts
  const fmt = makeFormatters(opts.lang)
  const since = new Date(Date.now() - (opts.rangeDays - 1) * DAY_MS)
  since.setHours(0, 0, 0, 0)
  const [parcels, company] = await Promise.all([
    fetchParcelsSince(since.toISOString()),
    fetchCompanyName(),
  ])

  const statusCounts = new Map<ParcelStatus, number>()
  const deptStats = new Map<string, { received: number; delivered: number; lead: number[]; open: number }>()
  const carrierCounts = new Map<string, number>()
  const typeCounts = new Map<string, number>()
  const leadHours: number[] = []
  let delivered = 0
  let open = 0

  for (const p of parcels) {
    statusCounts.set(p.status, (statusCounts.get(p.status) ?? 0) + 1)
    typeCounts.set(p.parcel_type, (typeCounts.get(p.parcel_type) ?? 0) + 1)
    const carrier = p.carrier?.name ?? t('reports.doc.noCarrier')
    carrierCounts.set(carrier, (carrierCounts.get(carrier) ?? 0) + 1)

    const dept = p.department?.name ?? t('reports.doc.noDepartment')
    if (!deptStats.has(dept)) deptStats.set(dept, { received: 0, delivered: 0, lead: [], open: 0 })
    const d = deptStats.get(dept)!
    d.received += 1
    if (OPEN_STATUSES.has(p.status)) {
      open += 1
      d.open += 1
    }
    if (p.delivered_at) {
      delivered += 1
      d.delivered += 1
      const hours = (new Date(p.delivered_at).getTime() - new Date(p.registered_at).getTime()) / 3_600_000
      leadHours.push(hours)
      d.lead.push(hours)
    }
  }

  const total = parcels.length
  const lead = median(leadHours)
  const statusOrder: ParcelStatus[] = [
    'unassigned', 'registered', 'in_storage', 'in_transit', 'in_locker',
    'delivered', 'rejected', 'returned',
  ]

  const sections: ReportSection[] = [
    {
      blocks: [
        {
          kind: 'kpis',
          items: [
            { label: t('reports.doc.kpiReceived'), value: fmt.nf.format(total) },
            { label: t('reports.doc.kpiDelivered'), value: fmt.nf.format(delivered) },
            {
              label: t('reports.doc.kpiLead'),
              value: lead != null ? t('reports.doc.hoursValue', { value: fmt.nf1.format(lead) }) : '—',
            },
            { label: t('reports.doc.kpiRejected'), value: fmt.nf.format(statusCounts.get('rejected') ?? 0) },
            { label: t('reports.doc.kpiReturned'), value: fmt.nf.format(statusCounts.get('returned') ?? 0) },
            { label: t('reports.doc.kpiOpen'), value: fmt.nf.format(open) },
          ],
        },
      ],
    },
    {
      heading: t('reports.doc.secStatus'),
      blocks: [
        {
          kind: 'table',
          columns: [t('reports.doc.colStatus'), t('reports.doc.colCount'), t('reports.doc.colShare')],
          rows: statusOrder
            .filter((s) => (statusCounts.get(s) ?? 0) > 0)
            .map((s) => [
              t(statusLabelKey[s]),
              fmt.nf.format(statusCounts.get(s)!),
              share(fmt.nf, statusCounts.get(s)!, total),
            ]),
        },
      ],
    },
    {
      heading: t('reports.doc.secDepartments'),
      blocks: [deptTable(deptStats, opts, fmt)],
    },
    {
      heading: t('reports.doc.secCarriers'),
      blocks: [
        {
          kind: 'table',
          columns: [t('reports.doc.colCarrier'), t('reports.doc.colCount'), t('reports.doc.colShare')],
          rows: [...carrierCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => [name, fmt.nf.format(count), share(fmt.nf, count, total)]),
        },
      ],
    },
    {
      heading: t('reports.doc.secTypes'),
      blocks: [
        {
          kind: 'table',
          columns: [t('reports.doc.colType'), t('reports.doc.colCount'), t('reports.doc.colShare')],
          rows: [...typeCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => [
              t(`reports.doc.type_${type}`, { defaultValue: type }),
              fmt.nf.format(count),
              share(fmt.nf, count, total),
            ]),
        },
      ],
    },
  ]

  return {
    title: t('reports.types.summary.title'),
    company,
    metaLines: [periodMeta(opts, fmt)],
    footer: footerLine(opts, fmt),
    sections,
  }
}

function deptTable(
  deptStats: Map<string, { received: number; delivered: number; lead: number[]; open: number }>,
  opts: ReportOptions,
  fmt: ReturnType<typeof makeFormatters>,
): ReportBlock {
  const { t } = opts
  return {
    kind: 'table',
    columns: [
      t('reports.doc.colDepartment'),
      t('reports.doc.colReceived'),
      t('reports.doc.colDelivered'),
      t('reports.doc.colMedianHours'),
      t('reports.doc.colOpen'),
    ],
    rows: [...deptStats.entries()]
      .sort((a, b) => b[1].received - a[1].received)
      .map(([name, d]) => {
        const lead = median(d.lead)
        return [
          name,
          fmt.nf.format(d.received),
          fmt.nf.format(d.delivered),
          lead != null ? fmt.nf1.format(lead) : '—',
          fmt.nf.format(d.open),
        ]
      }),
  }
}

// ── Undtagelsesrapport (øjebliksbillede) ────────────────────────────────────

async function buildExceptions(opts: ReportOptions): Promise<ReportDoc> {
  const { t } = opts
  const fmt = makeFormatters(opts.lang)
  const now = Date.now()

  // Åbne pakker (alle) + afviste fra de sidste 30 dage — spejler dashboardets
  // undtagelsesbegreb: uden modtager, forsinkede og afviste.
  const rejectedSince = new Date(now - 30 * DAY_MS).toISOString()
  const [openRes, rejectedRes, company] = await Promise.all([
    supabase
      .from('parcels')
      .select(PARCEL_SELECT)
      .in('status', [...OPEN_STATUSES])
      .order('registered_at', { ascending: true })
      .limit(2000),
    supabase
      .from('parcels')
      .select(PARCEL_SELECT)
      .eq('status', 'rejected')
      .gte('registered_at', rejectedSince)
      .order('registered_at', { ascending: true })
      .limit(2000),
    fetchCompanyName(),
  ])
  if (openRes.error) throw openRes.error
  if (rejectedRes.error) throw rejectedRes.error
  const openParcels = (openRes.data ?? []) as unknown as ParcelRow[]
  const rejected = (rejectedRes.data ?? []) as unknown as ParcelRow[]

  const ageDays = (p: ParcelRow) => Math.floor((now - new Date(p.registered_at).getTime()) / DAY_MS)
  const exceptions = [
    ...openParcels.filter((p) => p.status === 'unassigned' || ageDays(p) >= OVERDUE_DAYS),
    ...rejected,
  ].sort((a, b) => ageDays(b) - ageDays(a))

  const unassigned = openParcels.filter((p) => p.status === 'unassigned').length
  const overdue = openParcels.filter((p) => ageDays(p) >= OVERDUE_DAYS).length

  return {
    title: t('reports.types.exceptions.title'),
    company,
    metaLines: [t('reports.doc.snapshotLine', { date: fmt.dateTime.format(new Date()) })],
    footer: footerLine(opts, fmt),
    sections: [
      {
        blocks: [
          {
            kind: 'kpis',
            items: [
              { label: t('dashboard.statusUnassigned'), value: fmt.nf.format(unassigned) },
              { label: t('reports.doc.kpiOverdue', { days: OVERDUE_DAYS }), value: fmt.nf.format(overdue) },
              { label: t('dashboard.statusRejected'), value: fmt.nf.format(rejected.length) },
              { label: t('reports.doc.kpiTotal'), value: fmt.nf.format(exceptions.length) },
            ],
          },
        ],
      },
      {
        heading: t('reports.doc.secExceptions'),
        blocks: [
          exceptions.length === 0
            ? { kind: 'text', text: t('reports.doc.emptyTable') }
            : {
                kind: 'table',
                columns: [
                  t('reports.doc.colBarcode'),
                  t('reports.doc.colReceiver'),
                  t('reports.doc.colDepartment'),
                  t('reports.doc.colStatus'),
                  t('reports.doc.colAge'),
                  t('reports.doc.colRegistered'),
                ],
                rows: exceptions.map((p) => [
                  p.barcode ?? '—',
                  p.receiver?.full_name ?? '—',
                  p.department?.name ?? '—',
                  t(statusLabelKey[p.status]),
                  fmt.nf.format(ageDays(p)),
                  fmt.date.format(new Date(p.registered_at)),
                ]),
              },
        ],
      },
    ],
  }
}

// ── Afdelingsrapport ────────────────────────────────────────────────────────

async function buildDepartments(opts: ReportOptions): Promise<ReportDoc> {
  const { t } = opts
  const fmt = makeFormatters(opts.lang)
  const since = new Date(Date.now() - (opts.rangeDays - 1) * DAY_MS)
  since.setHours(0, 0, 0, 0)
  const [parcels, company] = await Promise.all([
    fetchParcelsSince(since.toISOString()),
    fetchCompanyName(),
  ])

  const deptStats = new Map<
    string,
    { received: number; delivered: number; failed: number; lead: number[]; open: number }
  >()
  for (const p of parcels) {
    const dept = p.department?.name ?? t('reports.doc.noDepartment')
    if (!deptStats.has(dept))
      deptStats.set(dept, { received: 0, delivered: 0, failed: 0, lead: [], open: 0 })
    const d = deptStats.get(dept)!
    d.received += 1
    if (OPEN_STATUSES.has(p.status)) d.open += 1
    if (p.status === 'rejected' || p.status === 'returned') d.failed += 1
    if (p.delivered_at) {
      d.delivered += 1
      d.lead.push(
        (new Date(p.delivered_at).getTime() - new Date(p.registered_at).getTime()) / 3_600_000,
      )
    }
  }

  const totals = [...deptStats.values()].reduce(
    (acc, d) => ({
      received: acc.received + d.received,
      delivered: acc.delivered + d.delivered,
      failed: acc.failed + d.failed,
      lead: acc.lead.concat(d.lead),
      open: acc.open + d.open,
    }),
    { received: 0, delivered: 0, failed: 0, lead: [] as number[], open: 0 },
  )

  const row = (name: string, d: typeof totals) => {
    const lead = median(d.lead)
    return [
      name,
      fmt.nf.format(d.received),
      fmt.nf.format(d.delivered),
      fmt.nf.format(d.failed),
      lead != null ? fmt.nf1.format(lead) : '—',
      fmt.nf.format(d.open),
    ]
  }

  return {
    title: t('reports.types.departments.title'),
    company,
    metaLines: [periodMeta(opts, fmt)],
    footer: footerLine(opts, fmt),
    sections: [
      {
        heading: t('reports.doc.secDepartments'),
        blocks: [
          {
            kind: 'table',
            columns: [
              t('reports.doc.colDepartment'),
              t('reports.doc.colReceived'),
              t('reports.doc.colDelivered'),
              t('reports.doc.colRejectedReturned'),
              t('reports.doc.colMedianHours'),
              t('reports.doc.colOpen'),
            ],
            rows: [
              ...[...deptStats.entries()]
                .sort((a, b) => b[1].received - a[1].received)
                .map(([name, d]) => row(name, d)),
              row(t('reports.doc.totalRow'), totals),
            ],
          },
        ],
      },
    ],
  }
}

// ── Pakkehistorik (chain of custody) ────────────────────────────────────────

async function buildCustody(opts: ReportOptions): Promise<ReportDoc> {
  const { t } = opts
  const fmt = makeFormatters(opts.lang)
  const barcode = opts.barcode?.trim() ?? ''

  const { data: parcelData, error: parcelErr } = await supabase
    .from('parcels')
    .select(PARCEL_SELECT)
    .eq('barcode', barcode)
    .order('registered_at', { ascending: false })
    .limit(1)
  if (parcelErr) throw parcelErr
  const parcel = (parcelData?.[0] ?? null) as unknown as ParcelRow | null
  if (!parcel) throw new Error('parcel_not_found')

  const [eventsRes, locationsRes, usersRes, company] = await Promise.all([
    supabase
      .from('parcel_events')
      .select(
        'id, event_type, from_status, to_status, from_location_id, to_location_id, actor_user_id, created_at',
      )
      .eq('parcel_id', parcel.id)
      .order('created_at', { ascending: true })
      .limit(1000),
    supabase.from('storage_locations').select('id, name'),
    // Aktørnavne er kun synlige for managers/platform-admins (RLS) — best effort.
    supabase.from('app_users').select('user_id, full_name'),
    fetchCompanyName(),
  ])
  if (eventsRes.error) throw eventsRes.error
  const events = (eventsRes.data ?? []) as EventRow[]
  const locations = new Map((locationsRes.data ?? []).map((l) => [l.id, l.name]))
  const users = new Map((usersRes.data ?? []).map((u) => [u.user_id, u.full_name]))

  const statusText = (s: ParcelStatus | null) => (s ? t(statusLabelKey[s]) : '—')
  const field = (key: string, value: string | null | undefined): string[] => [
    t(`reports.doc.${key}`),
    value || '—',
  ]

  return {
    title: t('reports.types.custody.title'),
    company,
    metaLines: [t('reports.doc.custodyLine', { barcode })],
    footer: footerLine(opts, fmt),
    sections: [
      {
        heading: t('reports.doc.secParcel'),
        blocks: [
          {
            kind: 'table',
            columns: [t('reports.doc.colField'), t('reports.doc.colValue')],
            rows: [
              field('fieldBarcode', parcel.barcode),
              field('fieldStatus', t(statusLabelKey[parcel.status])),
              field('fieldReceiver', parcel.receiver?.full_name),
              field('fieldDepartment', parcel.department?.name),
              field('fieldSender', parcel.sender),
              field('fieldCarrier', parcel.carrier?.name),
              field('fieldType', t(`reports.doc.type_${parcel.parcel_type}`, { defaultValue: parcel.parcel_type })),
              field('fieldPrivate', t(parcel.is_private ? 'reports.doc.yes' : 'reports.doc.no')),
              field('fieldRegistered', fmt.dateTime.format(new Date(parcel.registered_at))),
              field(
                'fieldDelivered',
                parcel.delivered_at ? fmt.dateTime.format(new Date(parcel.delivered_at)) : null,
              ),
              field('fieldDeliveredTo', parcel.delivered_to),
              field('fieldLocation', parcel.location?.name),
            ],
          },
        ],
      },
      {
        heading: t('reports.doc.secEvents'),
        blocks: [
          events.length === 0
            ? { kind: 'text', text: t('reports.doc.emptyTable') }
            : {
                kind: 'table',
                columns: [
                  t('reports.doc.colTime'),
                  t('reports.doc.colEvent'),
                  t('reports.doc.colFrom'),
                  t('reports.doc.colTo'),
                  t('reports.doc.colLocation'),
                  t('reports.doc.colActor'),
                ],
                rows: events.map((ev) => [
                  fmt.dateTime.format(new Date(ev.created_at)),
                  t(`dashboard.evt.${ev.event_type}`, { defaultValue: ev.event_type }),
                  statusText(ev.from_status),
                  statusText(ev.to_status),
                  locations.get(ev.to_location_id ?? '') ??
                    locations.get(ev.from_location_id ?? '') ??
                    '—',
                  (ev.actor_user_id && users.get(ev.actor_user_id)) || '—',
                ]),
              },
        ],
      },
    ],
  }
}

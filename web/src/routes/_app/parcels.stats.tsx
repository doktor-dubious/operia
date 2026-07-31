import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
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
  Text,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Package,
  PackageCheck,
  ShieldAlert,
  Timer,
  Boxes,
  TrendingUp,
  TrendingDown,
  ArrowRight,
} from 'lucide-react'
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
import { InfoTip } from '@/components/info-tip'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  ParcelStatusBadge,
  statusLabelKey,
  type ParcelStatus,
} from '@/components/parcel-status-badge'

// Statistik: ledelsesrettet overblik over pakkeflowet med rigtige diagrammer
// (shadcn charts/recharts). To kilder fodrer siden:
//  1) et 180-dages vindue (useStatsData) → nøgletal + diagrammer, hvor delta'er
//     kan sammenlignes med den foregående periode; alt aggregeres i useMemo.
//  2) den aktuelle drift (useOpsData) → undtagelseshåndtering (uassignerede,
//     afviste, overskredne) og den seneste aktivitet fra den immutable
//     parcel_events-log. Disse to lister er "nu"-billeder og påvirkes derfor
//     ikke af periodevælgeren ovenover.
// Denne side afløste det tidligere separate parcels/dashboard; de operationelle
// afsnit nederst er dashboardets undtagelses- og aktivitetskort, foldet ind.
// Diagramfarverne er --chart-1..5 fra index.css (CVD-valideret palet, fast
// slot-rækkefølge).
export const Route = createFileRoute('/_app/parcels/stats')({
  component: StatsPage,
})

const DAY_MS = 86_400_000
const OVERDUE_DAYS = 3

// Perioder i vælgeren. 'year' = 1. januar til i dag, 'all' = fra den ældste
// pakke. Hentevinduet følger valget (se useStatsData), så en 1-dags visning ikke
// slæber et halvt år med hjem.
const RANGES = ['1', '3', '7', '14', '30', '90', 'year', 'all'] as const
type RangeKey = (typeof RANGES)[number]

// 'all' kappes: en kunde med flere års historik ville ellers give en dagsserie
// med tusinder af punkter (og en hentning der rammer rækkeloftet).
const MAX_RANGE_DAYS = 1095

// Loft på antal hentede rækker. Rammes det, siges det højt i UI'et i stedet for
// at vise et stille afkortet billede.
const MAX_ROWS = 20_000

const daysSince = (from: number) =>
  Math.floor((startOfDayTs(Date.now()) - startOfDayTs(from)) / DAY_MS) + 1

// Antal dage perioden dækker (inkl. i dag). 'all' kræver den ældste pakkes dato,
// som hentes separat — indtil den er kendt, bruges 90 dage.
function rangeToDays(range: RangeKey, earliest: number | null): number {
  if (range === 'year') return daysSince(new Date(new Date().getFullYear(), 0, 1).getTime())
  if (range === 'all') return earliest ? Math.min(daysSince(earliest), MAX_RANGE_DAYS) : 90
  return Number(range)
}

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
  updated_at: string | null
  // registered_by peger på auth.users og har INGEN fremmednøgle til app_users,
  // så navnet kan ikke embeddes — det slås op i useAppUsers-kortet.
  registered_by: string | null
  department: { name: string } | null
  carrier: { name: string } | null
  receiver: { full_name: string } | null
  // Fritekst fra indleveringen — kan være tom, og samme afsender kan være
  // stavet med forskelligt bogstavskifte/mellemrum (se normalizeSender).
  sender: string | null
}

// Hvornår forlod pakken det åbne flow? 'delivered' har delivered_at; retur/
// afvisning har kun updated_at (tidspunktet for overgangen). Åbne pakker er
// stadig i huset og har derfor ingen lukketid.
const closedAt = (p: Row): number | null =>
  OPEN_STATUSES.has(p.status)
    ? null
    : new Date(p.delivered_at ?? p.updated_at ?? p.registered_at).getTime()

// Ud af huset: udleveret til modtageren ELLER sendt retur til afsenderen. Den
// gamle 'rejected' tælles IKKE med — en afvist pakke er flagget til retur, men
// står stadig i receptionen indtil den faktisk sendes (jf. 20260717180000).
const isOutgoing = (status: ParcelStatus) => status === 'delivered' || status === 'returned'

// 'rejected' er lagt sammen med 'returned': en afvisning sender pakken direkte
// retur til afsenderen, så de to er samme udfald set udefra (den mellemliggende
// status opstår ikke længere i drift — kun i ældre data).
type Outcome = 'delivered' | 'open' | 'returned'

const outcomeOf = (status: ParcelStatus): Outcome =>
  status === 'delivered'
    ? 'delivered'
    : status === 'returned' || status === 'rejected'
      ? 'returned'
      : 'open'

// Midnat som timestamp — bruges af periodeberegningen ovenfor (som står før
// startOfDay, der returnerer en Date).
function startOfDayTs(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

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

// Antal navne i en rangliste, før halen foldes sammen. Otte søjler kan læses i
// ét blik; derover bliver kortet en tabel i forklædning.
const TOP_N = 8

// Rangliste med hale: de TOP_N største beholdes, resten lægges sammen i én
// "Øvrige"-søjle, så summen stadig svarer til periodens total. Halen droppes
// aldrig i stilhed — den ville få kortet til at se udtømmende ud uden at være det.
function rankWithTail(
  counts: Map<string, number>,
  otherLabel: (rest: number) => string,
  topN = TOP_N,
) {
  const all = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const head = all.slice(0, topN).map(([name, count]) => ({ name, count }))
  const tail = all.slice(topN)
  if (tail.length > 0) {
    head.push({ name: otherLabel(tail.length), count: tail.reduce((sum, [, c]) => sum + c, 0) })
  }
  return head
}

// Afsenderen er fritekst, så "PostNord", "postnord " og "Post  Nord" ville blive
// tre navne i ranglisten. Nøglen er derfor små bogstaver med samlede mellemrum;
// den først sete stavemåde bruges som visningsnavn.
const senderKey = (raw: string) => raw.trim().replace(/\s+/g, ' ').toLowerCase()

function addSender(counts: Map<string, { name: string; count: number }>, raw: string) {
  const key = senderKey(raw)
  const existing = counts.get(key)
  if (existing) existing.count += 1
  else counts.set(key, { name: raw.trim().replace(/\s+/g, ' '), count: 1 })
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Ældste pakke — grundlaget for 'all time'. Egen (bittelille) forespørgsel, så
// den ikke gentages ved hvert periodeskift.
function useEarliestParcel() {
  return useQuery({
    queryKey: ['parcel-stats-earliest'],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parcels')
        .select('registered_at')
        .neq('status', 'removed')
        .order('registered_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data ? new Date(data.registered_at).getTime() : null
    },
  })
}

// Nu-tal: åbne og overskredne pakker. Tælles server-side og UAFHÆNGIGT af
// perioden — ellers ville en 1-dags visning kun kende de pakker der tilfældigvis
// blev registreret i dag, og "Åbne pakker lige nu" ville være forkert.
function useNowCounts() {
  return useQuery({
    queryKey: ['parcel-stats-now'],
    queryFn: async () => {
      const overdueBefore = new Date(Date.now() - OVERDUE_DAYS * DAY_MS).toISOString()
      const open = [...OPEN_STATUSES]
      const [total, overdue] = await Promise.all([
        supabase.from('parcels').select('id', { count: 'exact', head: true }).in('status', open),
        supabase
          .from('parcels')
          .select('id', { count: 'exact', head: true })
          .in('status', open)
          .lte('registered_at', overdueBefore),
      ])
      if (total.error) throw total.error
      if (overdue.error) throw overdue.error
      return { openNow: total.count ?? 0, overdueNow: overdue.count ?? 0 }
    },
  })
}

// Perioden PLUS den foregående lige så lange periode (delta'erne sammenligner de
// to). 'all time' hentes uden datofilter.
function useStatsData(rangeDays: number, allTime: boolean) {
  return useQuery({
    queryKey: ['parcel-stats', allTime ? 'all' : rangeDays],
    queryFn: async () => {
      const since = new Date(startOfDayTs(Date.now()) - (rangeDays * 2 - 1) * DAY_MS).toISOString()
      const { data, error } = await supabase
        .from('parcels')
        .select(
          // Modtageren skal navngives med sin fremmednøgle: parcels har to
          // FK'er til employees (tilsigtet vs. faktisk modtager), og en
          // ukvalificeret employees-embed er derfor tvetydig (PGRST201).
          `status, registered_at, delivered_at, updated_at, registered_by, sender,
           department:departments (name),
           carrier:carriers (name),
           receiver:employees!parcels_receiver_employee_id_fkey (full_name)`,
        )
        // Annullerede fejlregistreringer holdes ude: pakken fandtes ikke, så den
        // hverken ankom (volumen) eller står åben (udfald).
        .neq('status', 'removed')
        .gte('registered_at', allTime ? new Date(0).toISOString() : since)
        .order('registered_at', { ascending: false })
        .limit(MAX_ROWS)
      if (error) throw error
      return (data ?? []) as unknown as Row[]
    },
  })
}

type NotifyRow = { channel: 'email' | 'sms'; created_at: string }

// Sendte notifikationer (e-mail/SMS) i perioden. parcel_notifications er
// RLS-scopet til egen virksomhed; kun gennemførte afsendelser (status='sent')
// tælles, og testsendinger fra status-testdialogen (digest_key 'test-…')
// holdes ude. NB: null-digest_key skal eksplicit tillades — et rent
// not-like ville også filtrere null-rækker fra.
function useNotifyData(rangeDays: number, allTime: boolean) {
  return useQuery({
    queryKey: ['parcel-stats-notify', allTime ? 'all' : rangeDays],
    queryFn: async () => {
      const since = new Date(startOfDayTs(Date.now()) - (rangeDays - 1) * DAY_MS).toISOString()
      const { data, error } = await supabase
        .from('parcel_notifications')
        .select('channel, created_at')
        .eq('status', 'sent')
        .or('digest_key.is.null,digest_key.not.like.test-%')
        .gte('created_at', allTime ? new Date(0).toISOString() : since)
        .limit(MAX_ROWS)
      if (error) throw error
      return (data ?? []) as NotifyRow[]
    },
  })
}

type HandoutRow = { actor_user_id: string | null }

// Hvem der UDLEVEREDE pakken står ikke på pakkerækken — kun i den immutable
// parcel_events-log, som 'status_changed' → 'delivered'. Den hentes derfor for
// sig og tælles pr. bruger. (Manager-overstyringer skriver også en
// 'receiver_overridden'-linje, men status_changed'en kommer med som normalt, så
// en overstyret udlevering tælles præcis én gang.)
function useHandoutData(rangeDays: number, allTime: boolean) {
  return useQuery({
    queryKey: ['parcel-stats-handouts', allTime ? 'all' : rangeDays],
    queryFn: async () => {
      const since = new Date(startOfDayTs(Date.now()) - (rangeDays - 1) * DAY_MS).toISOString()
      const { data, error } = await supabase
        .from('parcel_events')
        .select('actor_user_id')
        .eq('event_type', 'status_changed')
        .eq('to_status', 'delivered')
        .gte('created_at', allTime ? new Date(0).toISOString() : since)
        .limit(MAX_ROWS)
      if (error) throw error
      return (data ?? []) as HandoutRow[]
    },
  })
}

// Navnene på virksomhedens systembrugere. Egen (lille) forespørgsel, fordi
// hverken parcels.registered_by eller parcel_events.actor_user_id har en
// fremmednøgle til app_users — sammenkoblingen sker på klienten.
function useAppUsers() {
  return useQuery({
    queryKey: ['parcel-stats-app-users'],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_users').select('user_id, full_name, email')
      if (error) throw error
      // full_name har default '' — en bruger der aldrig fik udfyldt navnet
      // vises på sin e-mail frem for at ende i "Ukendt bruger".
      return new Map(
        (data ?? []).map((u) => [u.user_id, u.full_name?.trim() || u.email?.trim() || null]),
      )
    },
  })
}

// Åbne + afviste pakker = kandidaterne til undtagelseslisten (uafhængigt af
// alder, så gamle uafhentede fanges). Leverede/returnerede er afsluttede og
// hentes ikke.
const EXCEPTION_STATUSES: ParcelStatus[] = [
  'unassigned',
  'registered',
  'in_storage',
  'in_transit',
  'in_locker',
  'rejected',
]

type ExceptionRow = {
  id: string
  barcode: string | null
  status: ParcelStatus
  registered_at: string
  receiver: { full_name: string } | null
  receiver_override_reason: string | null
  receiver_override_at: string | null
  removed_at: string | null
}

// Manager-undtagelser (overstyret modtager, fjernet fejlregistrering) hører til
// undtagelseslisten, men i modsætning til de åbne pakker hober de sig op for
// evigt — kun de seneste dage vises.
const MANAGER_EXCEPTION_DAYS = 30

type EventRow = {
  id: number
  event_type: string
  to_status: ParcelStatus | null
  created_at: string
  parcel: { barcode: string | null } | null
}

// Driftskilde: undtagelseskandidater + de seneste hændelser. Skilt fra
// useStatsData, fordi den ikke er periodeafgrænset (aktuel tilstand).
function useOpsData() {
  return useQuery({
    queryKey: ['parcel-stats-ops'],
    queryFn: async () => {
      const managerSince = new Date(Date.now() - MANAGER_EXCEPTION_DAYS * DAY_MS).toISOString()
      const [parcels, events] = await Promise.all([
        supabase
          .from('parcels')
          .select(
            `id, barcode, status, registered_at, receiver_override_reason, receiver_override_at, removed_at,
             receiver:employees!parcels_receiver_employee_id_fkey (full_name)`,
          )
          // Åbne/afviste pakker ELLER en manager-handling inden for vinduet.
          .or(
            [
              `status.in.(${EXCEPTION_STATUSES.join(',')})`,
              `receiver_override_at.gte.${managerSince}`,
              `removed_at.gte.${managerSince}`,
            ].join(','),
          )
          .order('registered_at', { ascending: true })
          .limit(500),
        supabase
          .from('parcel_events')
          .select('id, event_type, to_status, created_at, parcel:parcels (barcode)')
          .order('created_at', { ascending: false })
          .limit(10),
      ])
      if (parcels.error) throw parcels.error
      if (events.error) throw events.error
      return {
        parcels: (parcels.data ?? []) as unknown as ExceptionRow[],
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

// Navne på y-aksen i de vandrette søjlediagrammer. Længden kappes, så en lang
// medarbejdertitel ikke skubber søjlerne, og udvalgte etiketter kan få et
// info-ikon med sig (bruges til "Uden bruger"/"Ukendt bruger", som ellers
// kræver en forklaring læseren ikke kan gætte sig til).
//
// Selve teksten tegnes med recharts' egen <Text>, så tick'en ser præcis ud som
// standardtick'en — recharts sender kun tickProps videre til et custom-element
// (ikke den formaterede værdi), så afkortningen sker her i stedet for i en
// tickFormatter. Ikonet ligger i et <foreignObject>, fordi InfoTip er et
// HTML-komponent (lucide-ikon + shadcn-tooltip) og ikke kan tegnes direkte i SVG.
const TICK_MAX_CHARS = 17
const INFO_SIZE = 14 // = InfoTip'ens h-3.5/w-3.5

type CategoryTickProps = {
  x?: number
  y?: number
  payload?: { value?: string }
  // Etiket → forklaring. Kun de samlebånds-etiketter der ikke navngiver en
  // person ("Uden bruger", "Ukendt bruger") har brug for en.
  info?: Record<string, string>
}

function CategoryTick({ info, ...tick }: CategoryTickProps) {
  const { x = 0, y = 0, payload } = tick
  const value = String(payload?.value ?? '')
  const label = value.length > TICK_MAX_CHARS ? `${value.slice(0, TICK_MAX_CHARS - 1)}…` : value
  const infoText = info?.[value]
  const withInfo = !!infoText
  return (
    <>
      {/* Teksten rykkes til venstre for at gøre plads til ikonet, så de to
          ikke lægger sig oven i hinanden på den ene række der har et. */}
      <Text {...tick} x={withInfo ? x - (INFO_SIZE + 4) : x}>
        {label}
      </Text>
      {withInfo && (
        <foreignObject x={x - INFO_SIZE} y={y - INFO_SIZE / 2} width={INFO_SIZE} height={INFO_SIZE}>
          <InfoTip text={infoText} />
        </foreignObject>
      )}
    </>
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
  const [range, setRange] = useState<RangeKey>('90')
  const { data: earliest } = useEarliestParcel()
  const rangeDays = rangeToDays(range, earliest ?? null)
  const { data: rows, isPending } = useStatsData(rangeDays, range === 'all')
  const { data: notifyRows, isPending: notifyPending } = useNotifyData(rangeDays, range === 'all')
  const { data: handoutRows, isPending: handoutPending } = useHandoutData(rangeDays, range === 'all')
  const { data: userNames, isPending: usersPending } = useAppUsers()
  const { data: nowCounts } = useNowCounts()
  const { data: ops, isPending: opsPending } = useOpsData()
  const relTime = useRelativeTime()
  const openNow = nowCounts?.openNow ?? 0
  const overdueNow = nowCounts?.overdueNow ?? 0
  // Serier slået fra i pakkeflow-diagrammet (klik i signaturen).
  const [hiddenFlow, setHiddenFlow] = useState<Set<string>>(new Set())

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

    // Dagsserie initialiseres, så tomme dage vises som 0.
    //   ind    = registreret den dag,
    //   ud     = udleveret eller sendt retur den dag,
    //   lager  = åbne pakker ved dagens slutning (beholdning, ikke flow).
    const daily = new Map<
      string,
      { ts: number; incoming: number; outgoing: number; opened: number; closed: number; storage: number }
    >()
    const dayOrder: string[] = []
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = startOfDay(now - i * DAY_MS)
      const key = dayKey(d)
      dayOrder.push(key)
      daily.set(key, { ts: d.getTime(), incoming: 0, outgoing: 0, opened: 0, closed: 0, storage: 0 })
    }


    // ISO-ugedag 0=man..6=søn; forekomster tælles så profilen kan vise snit/dag.
    const weekdayTotals = Array.from({ length: 7 }, () => 0)
    const weekdayOccurrences = Array.from({ length: 7 }, () => 0)
    for (let i = 0; i < rangeDays; i++) {
      weekdayOccurrences[(new Date(rangeStart + i * DAY_MS).getDay() + 6) % 7] += 1
    }

    const outcomes: Record<Outcome, number> = { delivered: 0, open: 0, returned: 0 }
    const deptCounts = new Map<string, number>()
    const carrierCounts = new Map<string, number>()
    const receiverCounts = new Map<string, number>()
    // Normaliseret nøgle → visningsnavn + antal (se addSender).
    const senderCounts = new Map<string, { name: string; count: number }>()
    // Afsender er valgfri ved indlevering. De tomme tælles for sig og nævnes
    // under diagrammet — de hører ikke i en rangliste over navne, men de må
    // heller ikke forsvinde i stilhed og få kortet til at se udtømmende ud.
    let senderMissing = 0
    const leadByWeek = new Map<number, number[]>()
    // Pakker uden modtager (uassignerede, eller hvis medarbejderen er slettet)
    // får deres egen søjle frem for at forsvinde ud af ranglisten.
    const noReceiverLabel = t('dashboard.noReceiver')

    let received = 0
    let receivedPrev = 0
    let delivered = 0
    let deliveredPrev = 0
    const leadHours: number[] = []
    const leadHoursPrev: number[] = []

    for (const p of parcels) {
      const regTs = new Date(p.registered_at).getTime()
      const closeTs = closedAt(p)

      // Beholdning: hvor mange åbnede/lukkede hver dag i perioden.
      if (regTs >= rangeStart) {
        const bucket = daily.get(dayKey(new Date(regTs)))
        if (bucket) bucket.opened += 1
      }
      if (closeTs != null && closeTs >= rangeStart) {
        const bucket = daily.get(dayKey(new Date(closeTs)))
        if (bucket) bucket.closed += 1
      }

      if (regTs >= rangeStart) {
        received += 1
        outcomes[outcomeOf(p.status)] += 1
        weekdayTotals[(new Date(regTs).getDay() + 6) % 7] += 1
        const dept = p.department?.name
        if (dept) deptCounts.set(dept, (deptCounts.get(dept) ?? 0) + 1)
        const carrier = p.carrier?.name
        if (carrier) carrierCounts.set(carrier, (carrierCounts.get(carrier) ?? 0) + 1)
        const receiver = p.receiver?.full_name?.trim() || noReceiverLabel
        receiverCounts.set(receiver, (receiverCounts.get(receiver) ?? 0) + 1)
        if (p.sender?.trim()) addSender(senderCounts, p.sender)
        else senderMissing += 1
        const bucket = daily.get(dayKey(new Date(regTs)))
        if (bucket) bucket.incoming += 1
      } else if (regTs >= prevStart) {
        receivedPrev += 1
      }

      // Ud af huset (udleveret ELLER retur) — kun dagsserien. Nøgletallet
      // nedenfor bliver med vilje ved at måle rene udleveringer, så tallet
      // betyder det samme som før.
      if (isOutgoing(p.status) && closeTs != null && closeTs >= rangeStart) {
        const bucket = daily.get(dayKey(new Date(closeTs)))
        if (bucket) bucket.outgoing += 1
      }

      // Udleveringer: nøgletal, delta og ekspeditionstid.
      if (p.delivered_at) {
        const delTs = new Date(p.delivered_at).getTime()
        const hours = (delTs - regTs) / 3_600_000
        if (delTs >= rangeStart) {
          delivered += 1
          leadHours.push(hours)
          const wk = weekStart(new Date(delTs)).getTime()
          if (!leadByWeek.has(wk)) leadByWeek.set(wk, [])
          leadByWeek.get(wk)!.push(hours)
        } else if (delTs >= prevStart) {
          deliveredPrev += 1
          leadHoursPrev.push(hours)
        }
      }
    }

    // Beholdningen regnes BAGUD fra det eksakte antal åbne pakker i dag:
    //   lager(i dag)   = openNow
    //   lager(dag − 1) = lager(dag) − åbnede(dag) + lukkede(dag)
    // Det gør serien rigtig uanset hvor kort perioden er — modsat en fremad-
    // beregning, der skulle kende beholdningen ved periodens start og dermed
    // hente hele historikken.
    let stock = openNow
    for (let i = dayOrder.length - 1; i >= 0; i--) {
      const bucket = daily.get(dayOrder[i])!
      bucket.storage = Math.max(0, stock)
      stock = stock - bucket.opened + bucket.closed
    }

    const pct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null)
    const leadMedian = median(leadHours)
    const leadMedianPrev = median(leadHoursPrev)

    return {
      received,
      delivered,
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
      carrierSeries: [...carrierCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6),
      receiverSeries: rankWithTail(receiverCounts, (rest) => t('stats.otherBucket', { count: rest })),
      senderSeries: rankWithTail(
        new Map([...senderCounts.values()].map((s) => [s.name, s.count])),
        (rest) => t('stats.otherBucket', { count: rest }),
      ),
      senderMissing,
      leadTrend: [...leadByWeek.entries()]
        .sort(([a], [b]) => a - b)
        .map(([wk, hours]) => ({
          week: t('stats.weekShort', { week: getISOWeek(new Date(wk)) }),
          hours: median(hours),
        })),
    }
  }, [rows, rangeDays, openNow, weekdayFmt, t])

  // Undtagelser: uassignerede + afviste + overskredne (åbne ældre end
  // OVERDUE_DAYS), nyeste problem øverst. Uafhængigt af periodevælgeren.
  const exceptions = useMemo(() => {
    const now = Date.now()
    return (ops?.parcels ?? [])
      .map((p) => ({
        id: p.id,
        barcode: p.barcode,
        receiver: p.receiver?.full_name ?? null,
        status: p.status,
        // Manager-afvigelser markeres, så rækken forklarer sig selv: en
        // overstyret pakke står ellers bare som "Udleveret".
        overridden: !!p.receiver_override_reason,
        removed: p.status === 'removed',
        ageDays: Math.floor((now - new Date(p.registered_at).getTime()) / DAY_MS),
      }))
      .filter(
        (p) =>
          p.overridden ||
          p.removed ||
          p.status === 'unassigned' ||
          p.status === 'rejected' ||
          (OPEN_STATUSES.has(p.status) && p.ageDays >= OVERDUE_DAYS),
      )
      .sort((a, b) => b.ageDays - a.ageDays)
  }, [ops])

  // Sendte notifikationer pr. dag — samme dagsbuckets som pakkeflowet, så de
  // to diagrammer kan sammenlignes lodret.
  const notifySeries = useMemo(() => {
    const now = Date.now()
    const daily = new Map<string, { ts: number; email: number; sms: number }>()
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = startOfDay(now - i * DAY_MS)
      daily.set(dayKey(d), { ts: d.getTime(), email: 0, sms: 0 })
    }
    for (const n of notifyRows ?? []) {
      const bucket = daily.get(dayKey(new Date(n.created_at)))
      if (bucket) bucket[n.channel] += 1
    }
    return [...daily.values()]
  }, [notifyRows, rangeDays])

  // Medarbejderbelastning: to mål pr. bruger — registreringer (intake, fra
  // pakkerækken) og udleveringer (fra hændelsesloggen). De stables, fordi de
  // tilsammen er personens samlede arbejde i perioden; rangordenen følger
  // summen. Navne slås op i app_users-kortet, se useAppUsers.
  const staffSeries = useMemo(() => {
    const rangeStart = startOfDay(Date.now() - (rangeDays - 1) * DAY_MS).getTime()
    // To forskellige "ingen person"-tilfælde, som IKKE må slås sammen:
    //
    //  • id'et mangler helt ⇒ "Uden bruger". Enten data skrevet uden session
    //    (service-role/SQL, fx demodata), ELLER en registrering hvis konto er
    //    slettet siden: parcels.registered_by er en FK til auth.users med
    //    `on delete set null`, så sletning af brugeren (GDPR-sletning under
    //    Brugere → delete-user) nulstiller feltet bagudrettet.
    //  • id'et findes, men ikke i app_users ⇒ "Ukendt bruger". Samme sletning
    //    rammer udleveringerne anderledes: parcel_events.actor_user_id har
    //    bevidst INGEN fremmednøgle (loggen er uforanderlig og må ikke kunne
    //    ændres af cascades), så id'et bliver stående uden et navn at slå op.
    //
    // Konsekvens: ÉN slettet medarbejder falder i BEGGE spande — indgangene
    // under "Uden bruger", udleveringerne under "Ukendt bruger". Det står i
    // info-teksterne, så tallet ikke læses som to forskellige personer.
    const nameOf = (id: string | null) =>
      !id ? t('stats.staffNoUser') : userNames?.get(id) || t('stats.staffUnknown')

    const registered = new Map<string, number>()
    const handedOut = new Map<string, number>()
    for (const p of rows ?? []) {
      // rows dækker to perioder (delta-sammenligningen) — kun den aktuelle tælles.
      if (new Date(p.registered_at).getTime() < rangeStart) continue
      const name = nameOf(p.registered_by)
      registered.set(name, (registered.get(name) ?? 0) + 1)
    }
    for (const h of handoutRows ?? []) {
      const name = nameOf(h.actor_user_id)
      handedOut.set(name, (handedOut.get(name) ?? 0) + 1)
    }

    const ranked = [...new Set([...registered.keys(), ...handedOut.keys()])]
      .map((name) => {
        const reg = registered.get(name) ?? 0
        const out = handedOut.get(name) ?? 0
        return { name, registered: reg, handedOut: out, total: reg + out }
      })
      .sort((a, b) => b.total - a.total)

    const head = ranked.slice(0, TOP_N)
    const tail = ranked.slice(TOP_N)
    if (tail.length > 0) {
      head.push({
        name: t('stats.otherBucket', { count: tail.length }),
        registered: tail.reduce((sum, r) => sum + r.registered, 0),
        handedOut: tail.reduce((sum, r) => sum + r.handedOut, 0),
        total: tail.reduce((sum, r) => sum + r.total, 0),
      })
    }
    return head
  }, [rows, handoutRows, userNames, rangeDays, t])

  const flowConfig = {
    incoming: { label: t('stats.incoming'), color: 'var(--chart-1)' },
    outgoing: { label: t('stats.outgoing'), color: 'var(--chart-2)' },
    storage: { label: t('stats.storage'), color: 'var(--chart-3)' },
  } satisfies ChartConfig
  const FLOW_KEYS = ['incoming', 'outgoing', 'storage'] as const

  const notifyConfig = {
    email: { label: t('stats.notifyEmail'), color: 'var(--chart-4)' },
    sms: { label: t('stats.notifySms'), color: 'var(--chart-5)' },
  } satisfies ChartConfig
  const NOTIFY_KEYS = ['email', 'sms'] as const

  const outcomeConfig = {
    count: { label: t('stats.parcels') },
    delivered: { label: t('dashboard.statusDelivered'), color: 'var(--chart-2)' },
    open: { label: t('stats.outcomeOpen'), color: 'var(--chart-1)' },
    returned: { label: t('dashboard.statusReturned'), color: 'var(--status-bad)' },
  } satisfies ChartConfig

  const weekdayConfig = {
    avg: { label: t('stats.avgPerDay'), color: 'var(--chart-1)' },
  } satisfies ChartConfig

  const deptConfig = {
    count: { label: t('stats.received'), color: 'var(--chart-1)' },
  } satisfies ChartConfig

  const carrierConfig = {
    count: { label: t('stats.received'), color: 'var(--chart-5)' },
  } satisfies ChartConfig

  const receiverConfig = {
    count: { label: t('stats.received'), color: 'var(--chart-3)' },
  } satisfies ChartConfig

  // Egen farve, så nabokortene i gitteret ikke ser ud som samme serie
  // (--chart-1 er afdelinger, --chart-3 modtagere, --chart-5 fragtfirmaer).
  const senderConfig = {
    count: { label: t('stats.received'), color: 'var(--chart-2)' },
  } satisfies ChartConfig

  // To serier ⇒ signatur er obligatorisk (identiteten må aldrig kun ligge i
  // farven). --chart-1/--chart-2 er det samme validerede par som pakkeflowet.
  const staffConfig = {
    registered: { label: t('stats.staffRegistered'), color: 'var(--chart-1)' },
    handedOut: { label: t('stats.staffHandedOut'), color: 'var(--chart-2)' },
  } satisfies ChartConfig

  const leadConfig = {
    hours: { label: t('stats.leadHours'), color: 'var(--chart-4)' },
  } satisfies ChartConfig

  // Klik i signaturen slår en serie fra/til. Sidste synlige serie kan ikke slås
  // fra — et tomt diagram er ikke en visning.
  const toggleFlowKey = (key: string) =>
    setHiddenFlow((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < FLOW_KEYS.length - 1) next.add(key)
      return next
    })

  const rangeLabel = (key: RangeKey) =>
    key === 'year'
      ? t('stats.rangeThisYear')
      : key === 'all'
        ? t('stats.rangeAll')
        : t('stats.lastDays', { count: Number(key) })

  const rangeSelect = (
    <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
      <SelectTrigger size="sm" className="w-[170px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {RANGES.map((key) => (
          <SelectItem key={key} value={key}>
            {rangeLabel(key)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Filterrække: én global periode, der styrer alle nøgletal og diagrammer */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t('stats.subtitle')}</p>
          {rangeSelect}
        </div>
        {/* Rækkeloftet er nået: sig det, frem for at vise et stille afkortet
            billede (typisk 'Al tid' hos en kunde med mange års historik). */}
        {(rows?.length ?? 0) >= MAX_ROWS && (
          <p className="text-xs text-status-neutral-to-bad">
            {t('stats.rowCap', { count: MAX_ROWS })}
          </p>
        )}
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
          value={nf.format(openNow)}
          sub={t('stats.overdueNow', { count: overdueNow })}
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
                {FLOW_KEYS.map((key) => (
                  <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.02} />
                  </linearGradient>
                ))}
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
              {FLOW_KEYS.map((key) => (
                <Area
                  key={key}
                  dataKey={key}
                  type="monotone"
                  stroke={`var(--color-${key})`}
                  strokeWidth={2}
                  fill={`url(#fill-${key})`}
                  hide={hiddenFlow.has(key)}
                />
              ))}
              {/* Egen signatur i stedet for ChartLegendContent: punkterne er
                  knapper, så en serie kan slås fra med mus OG tastatur. */}
              <ChartLegend
                content={() => (
                  <div className="flex flex-wrap items-center justify-center gap-4 pt-3">
                    {FLOW_KEYS.map((key) => {
                      const off = hiddenFlow.has(key)
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={!off}
                          onClick={() => toggleFlowKey(key)}
                          className={cn(
                            'flex cursor-pointer items-center gap-1.5 text-xs transition-opacity',
                            off ? 'opacity-40' : 'opacity-100',
                          )}
                        >
                          <span
                            className="size-2.5 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: `var(--color-${key})` }}
                          />
                          <span className={off ? 'line-through' : undefined}>
                            {flowConfig[key].label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </ChartCard>

      {/* Sendte notifikationer pr. dag — e-mail vs. SMS (kun gennemførte
          afsendelser, testsendinger fraregnet) */}
      <ChartCard title={t('stats.notifyTitle')} description={t('stats.notifyDesc')}>
        {notifyPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ChartContainer config={notifyConfig} className="aspect-auto h-64 w-full">
            <AreaChart data={notifySeries} margin={{ left: 4, right: 4 }}>
              <defs>
                {NOTIFY_KEYS.map((key) => (
                  <linearGradient key={key} id={`fill-notify-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.02} />
                  </linearGradient>
                ))}
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
              {NOTIFY_KEYS.map((key) => (
                <Area
                  key={key}
                  dataKey={key}
                  type="monotone"
                  stroke={`var(--color-${key})`}
                  strokeWidth={2}
                  fill={`url(#fill-notify-${key})`}
                />
              ))}
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

        {/* Top-fragtfirmaer — samme form som top-afdelinger */}
        <ChartCard title={t('stats.carrierTitle')} description={t('stats.carrierDesc')}>
          {isPending ? (
            <Skeleton className="h-56 w-full" />
          ) : model.carrierSeries.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('dashboard.noData')}</p>
          ) : (
            <ChartContainer config={carrierConfig} className="aspect-auto h-56 w-full">
              <BarChart data={model.carrierSeries} layout="vertical" margin={{ right: 24 }}>
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

        {/* Top-modtagere — samme vandrette søjleform som afdelinger/fragtfirmaer.
            Ikke en cirkel: en rangliste med lang hale af navne kan ikke aflæses
            som vinkler. Halen foldes til "Øvrige", så summen holder. */}
        <ChartCard title={t('stats.receiverTitle')} description={t('stats.receiverDesc')}>
          {isPending ? (
            <Skeleton className="h-72 w-full" />
          ) : model.receiverSeries.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('dashboard.noData')}</p>
          ) : (
            <ChartContainer config={receiverConfig} className="aspect-auto h-72 w-full">
              <BarChart data={model.receiverSeries} layout="vertical" margin={{ right: 28 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" hide />
                <YAxis
                  dataKey="name"
                  type="category"
                  tickLine={false}
                  axisLine={false}
                  width={124}
                  tick={<CategoryTick />}
                />
                <ChartTooltip cursor content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  <LabelList dataKey="count" position="right" className="fill-foreground" fontSize={11} />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </ChartCard>

        {/* Top-afsendere — samme form som top-modtagere. Afsenderen er fritekst,
            så navne slås sammen på tværs af bogstavskifte/mellemrum, og pakker
            uden afsender står som en linje under diagrammet frem for som en
            søjle, der ville dominere ranglisten uden at navngive nogen. */}
        <ChartCard title={t('stats.senderTitle')} description={t('stats.senderDesc')}>
          {isPending ? (
            <Skeleton className="h-72 w-full" />
          ) : model.senderSeries.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('dashboard.noData')}</p>
          ) : (
            <>
              <ChartContainer config={senderConfig} className="aspect-auto h-72 w-full">
                <BarChart data={model.senderSeries} layout="vertical" margin={{ right: 28 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={124}
                    tick={<CategoryTick />}
                  />
                  <ChartTooltip cursor content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} maxBarSize={20}>
                    <LabelList dataKey="count" position="right" className="fill-foreground" fontSize={11} />
                  </Bar>
                </BarChart>
              </ChartContainer>
              {model.senderMissing > 0 && (
                <p className="pt-2 text-xs text-muted-foreground">
                  {t('stats.senderMissing', { count: model.senderMissing })}
                </p>
              )}
            </>
          )}
        </ChartCard>

        {/* Medarbejderbelastning — stablet: registreringer + udleveringer pr.
            bruger. Stablingen er selve pointen (delene udgør personens samlede
            arbejde), og 2px mellemrum i panelfarven adskiller de to felter. */}
        <ChartCard title={t('stats.staffTitle')} description={t('stats.staffDesc')}>
          {isPending || handoutPending || usersPending ? (
            <Skeleton className="h-72 w-full" />
          ) : staffSeries.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('dashboard.noData')}</p>
          ) : (
            <>
              <ChartContainer config={staffConfig} className="aspect-auto h-72 w-full">
                <BarChart data={staffSeries} layout="vertical" margin={{ right: 28 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tickLine={false}
                    axisLine={false}
                    width={124}
                    tick={
                      <CategoryTick
                        info={{
                          [t('stats.staffNoUser')]: t('stats.staffNoUserInfo'),
                          [t('stats.staffUnknown')]: t('stats.staffUnknownInfo'),
                        }}
                      />
                    }
                  />
                  <ChartTooltip cursor content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="registered"
                    stackId="staff"
                    fill="var(--color-registered)"
                    stroke="var(--panel)"
                    strokeWidth={2}
                    maxBarSize={20}
                  />
                  <Bar
                    dataKey="handedOut"
                    stackId="staff"
                    fill="var(--color-handedOut)"
                    stroke="var(--panel)"
                    strokeWidth={2}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={20}
                  >
                    {/* Kun totalen direkte på søjlen — et tal pr. felt ville
                        støje mere end det oplyser; delene står i tooltippet. */}
                    <LabelList
                      dataKey="total"
                      position="right"
                      className="fill-foreground"
                      fontSize={11}
                    />
                  </Bar>
                  <ChartLegend content={<ChartLegendContent />} />
                </BarChart>
              </ChartContainer>
              {(handoutRows?.length ?? 0) >= MAX_ROWS && (
                <p className="pt-2 text-xs text-status-neutral-to-bad">
                  {t('stats.rowCap', { count: MAX_ROWS })}
                </p>
              )}
            </>
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

      {/* Drift (aktuel tilstand, uafhængig af perioden): undtagelseshåndtering
          + seneste aktivitet — foldet ind fra det tidligere dashboard. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title={t('dashboard.exceptions')}
          action={
            <Link
              to="/parcels/overview"
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('dashboard.viewAll')}
              <ArrowRight className="size-3" />
            </Link>
          }
        >
          {opsPending ? (
            <Skeleton className="h-40 w-full" />
          ) : exceptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('dashboard.noExceptions')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {exceptions.slice(0, 6).map((ex) => (
                <li key={ex.id} className="flex items-center justify-between gap-2 py-2 first:pt-0">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate font-mono text-xs">
                      {/* Statusbadgen forklarer ikke en overstyring (den står som
                          "Udleveret") — derfor et eget mærke på de rækker. */}
                      {ex.overridden && (
                        <ShieldAlert
                          aria-label={t('override.badge')}
                          className="size-3.5 shrink-0 text-status-neutral"
                        />
                      )}
                      {ex.barcode ?? '—'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ex.overridden
                        ? t('override.badge')
                        : (ex.receiver ?? t('dashboard.noReceiver'))}{' '}
                      · {t('dashboard.ageDays', { count: ex.ageDays })}
                    </p>
                  </div>
                  <ParcelStatusBadge status={ex.status} />
                </li>
              ))}
            </ul>
          )}
        </ChartCard>

        <ChartCard title={t('dashboard.recentActivity')}>
          {opsPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (ops?.events.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">{t('dashboard.noActivity')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {ops!.events.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-3 py-2 first:pt-0">
                  <p className="min-w-0 truncate text-xs">
                    <span className="font-mono">{ev.parcel?.barcode ?? '—'}</span>
                    <span className="text-muted-foreground">
                      {' · '}
                      {t(`dashboard.evt.${ev.event_type}`, { defaultValue: ev.event_type })}
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
        </ChartCard>
      </div>
    </div>
  )
}

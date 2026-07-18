import { useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/copy-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { RefreshCw } from '@/components/animate-ui/icons/refresh-cw'
import { Download } from '@/components/animate-ui/icons/download'
import { Columns3 } from '@/components/animate-ui/icons/columns-3'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'

// Operia → Logs (platform-admins): Supabase-Studio-lignende fremviser af den
// centrale NIS2-revisionslog (audit_log), skrevet server-side af triggere på
// tværs af tenants. Faceter (tidsrum + niveau + kategori + handling),
// aktivitetshistogram, tæt tabel og en Live-tilstand der auto-genhenter.
export const Route = createFileRoute('/_app/operia/logs')({
  component: LogsPage,
})

const RANGES = [
  { key: '60m', ms: 60 * 60 * 1000, labelKey: 'logsPage.range60m' },
  { key: '24h', ms: 24 * 60 * 60 * 1000, labelKey: 'logsPage.range24h' },
  { key: '7d', ms: 7 * 24 * 60 * 60 * 1000, labelKey: 'logsPage.range7d' },
  { key: '30d', ms: 30 * 24 * 60 * 60 * 1000, labelKey: 'logsPage.range30d' },
  { key: 'all', ms: null as number | null, labelKey: 'logsPage.rangeAll' },
]

// Niveau — de samme tre som Supabase Studio. Farven bruges både i facetten og
// som prikken foran hver logpost.
const LEVELS = [
  { key: 'success', color: 'bg-emerald-500', labelKey: 'logsPage.levels.success' },
  { key: 'warning', color: 'bg-amber-500', labelKey: 'logsPage.levels.warning' },
  { key: 'error', color: 'bg-red-500', labelKey: 'logsPage.levels.error' },
] as const

// Kategori = produktet/modulet hændelsen hører til. Rækkefølgen her styrer
// visningen i facetten. Etiketterne oversættes via logsPage.categories.<key>.
const CATEGORIES = [
  'parcels',
  'directory',
  'config',
  'assets',
  'inventory',
  'lockers',
  'shipping',
  'access',
  'entitlements',
  'branding',
  'maps',
  'imports',
  'log',
  'other',
] as const

const dateFmt = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'medium' })
const bucketFmt = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })
// X-akse-etiketter under histogrammet (som Supabase Studio): klokkeslæt for
// korte tidsrum (≤ 24t), dato for længere.
const axisTimeFmt = new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit' })
const axisDateFmt = new Intl.DateTimeFormat('da-DK', { day: '2-digit', month: '2-digit' })

// Tidsstempel-popup (som Supabase Studio): samme tidspunkt i UTC, i browserens
// tidszone, som relativ tid og som rå unix-ms.
const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const stampFmtOpts: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}
const tsUtcFmt = new Intl.DateTimeFormat('en-GB', { ...stampFmtOpts, timeZone: 'UTC' })
const tsLocalFmt = new Intl.DateTimeFormat('en-GB', stampFmtOpts)
const fmtStamp = (fmt: Intl.DateTimeFormat, ms: number) => fmt.format(ms).replace(',', '')

function relativeTime(ms: number, now: number, rtf: Intl.RelativeTimeFormat): string {
  const diff = ms - now
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000000],
    ['month', 2592000000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
    ['second', 1000],
  ]
  for (const [unit, per] of units)
    if (Math.abs(diff) >= per || unit === 'second') return rtf.format(Math.round(diff / per), unit)
  return rtf.format(0, 'second')
}
const BUCKETS = 48
const DAY_MS = 24 * 60 * 60 * 1000
const AXIS_STEP = 4 // vis en etiket for hver AXIS_STEP søjler

// Tabelkolonner (ud over niveau-prikken). Alle undtagen den sidste (Besked,
// som fylder resten) kan justeres i bredden ved at trække i kolonnekanten.
const COLUMNS = [
  { key: 'date', labelKey: 'logsPage.colDate' },
  { key: 'action', labelKey: 'logsPage.colAction' },
  { key: 'category', labelKey: 'logsPage.colCategory' },
  { key: 'company', labelKey: 'logsPage.colCompany' },
  { key: 'actor', labelKey: 'logsPage.colActor' },
  { key: 'message', labelKey: 'logsPage.colMessage' },
] as const
const DEFAULT_WIDTHS = [140, 160, 110, 130, 150] // date..actor (px); Besked flyder
const MIN_COL_WIDTH = 60

// Brugerpræferencer huskes i localStorage: facet-sektionernes sammenklap-
// tilstand og kolonnernes synlighed. Standard (manglende nøgle) = udfoldet/synlig.
const FACET_STORAGE_KEY = 'operia-logs-facets'
const COLUMN_STORAGE_KEY = 'operia-logs-columns'
function loadFlags(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as Record<string, boolean>
  } catch {
    /* korrupt/utilgængelig storage — brug standarden */
  }
  return {}
}
function saveFlags(key: string, value: Record<string, boolean>) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignorér utilgængelig storage */
  }
}

function useAuditLog(live: boolean) {
  return useQuery({
    queryKey: ['operia-audit-log'],
    refetchInterval: live ? 5000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_log')
        .select('id, created_at, action, entity_type, entity_id, summary, company_id, actor_user_id, detail')
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) throw error
      return data
    },
  })
}

function useCompanyNames() {
  return useQuery({
    queryKey: ['companies-for-logs'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name')
      if (error) throw error
      return new Map(data.map((c) => [c.id, c.name]))
    },
  })
}

// Aktør-opslag (audit_log.actor_user_id → navn/e-mail). Virksomhedsbrugere
// hentes fra app_users (platform-admin kan læse alle tenants); DCA-platform-
// admins har intet navn i public, så deres e-mail slås op via SECURITY DEFINER-
// funktionen admin_user_emails(). Funktionen kan mangle indtil migrationen er
// kørt — det håndteres uden fejl, så kolonnen blot falder tilbage til et id.
function useActorNames() {
  return useQuery({
    queryKey: ['actor-names-for-logs'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const map = new Map<string, string>()
      const { data: users, error } = await supabase
        .from('app_users')
        .select('user_id, full_name, email')
      if (error) throw error
      for (const u of users ?? []) map.set(u.user_id, u.full_name?.trim() || u.email || u.user_id)
      // Platform-admin-aktører: e-mail via RPC. Typerne kendes først efter
      // gen:types, så kaldet er løst typet; en manglende funktion giver blot
      // en fejl vi ignorerer.
      const { data: admins } = await (
        supabase.rpc as unknown as (
          fn: string,
        ) => Promise<{ data: { user_id: string; email: string | null }[] | null }>
      )('admin_user_emails')
      for (const a of admins ?? [])
        if (a.email && !map.has(a.user_id)) map.set(a.user_id, a.email)
      return map
    },
  })
}

type LogRow = NonNullable<ReturnType<typeof useAuditLog>['data']>[number]

// Klient-spejl af de tilsvarende SQL-hjælpere (audit_category / audit_level) —
// så faceterne virker med det samme, også før migrationens genererede kolonner
// er tilgængelige. Hold disse i sync med migrationen.
function categoryOf(action: string): string {
  switch (action.split('.')[0]) {
    case 'parcel':
    case 'parcel_flow':
      return 'parcels'
    case 'employee':
    case 'department':
      return 'directory'
    case 'location':
    case 'handling_class':
    case 'carrier':
    case 'general':
      return 'config'
    case 'shipping':
    case 'agreement':
      return 'shipping'
    case 'asset':
    case 'asset_category':
    case 'asset_location':
    case 'asset_flow':
    case 'assets':
      return 'assets'
    case 'inventory_item':
      return 'inventory'
    case 'locker':
      return 'lockers'
    case 'user':
      return 'access'
    case 'product':
    case 'feature':
      return 'entitlements'
    case 'template':
    case 'language':
    case 'currency':
    case 'appearance':
    case 'product_text':
    case 'home':
    case 'handheld':
      return 'branding'
    case 'maps':
    case 'route':
      return 'maps'
    case 'import':
    case 'import_config':
    case 'data_transfer':
      return 'imports'
    case 'log_drain':
    case 'retention':
      return 'log'
    default:
      return 'other'
  }
}

function levelOf(r: LogRow): 'success' | 'warning' | 'error' {
  const a = r.action
  // '*_failed'/'*_bounced' = teknisk fejl (import.failed, asset.reminder_bounced,
  // …). Spejler public.audit_level.
  if (/[._](failed|bounced)$/.test(a) || a === 'data_transfer.spoof_rejected') return 'error'
  const to = (r.detail as Record<string, unknown> | null)?.to_status
  if (
    a === 'import.rejected' ||
    /[._]complained$/.test(a) ||
    /\.(deleted|deactivated|anonymized|removed|revoked|disabled)$/.test(a) ||
    (a === 'parcel.status_changed' && (to === 'rejected' || to === 'returned'))
  )
    return 'warning'
  return 'success'
}

const levelColor = (level: string) =>
  LEVELS.find((l) => l.key === level)?.color ?? 'bg-muted-foreground/40'

type TFn = (key: string, opts?: Record<string, unknown>) => string

function message(r: LogRow, t: TFn) {
  const d = (r.detail ?? {}) as Record<string, unknown>
  // Hændelser skrevet server-side med en fast (dansk) sætning gengives i stedet
  // fra i18n ud fra detail, så beskeden følger fremviserens sprog.
  if (r.action === 'data_transfer.spoof_rejected') {
    return t('logsPage.msg.spoofRejected', { from: (d.from as string) || r.summary || '—' })
  }
  if (r.action === 'retention.purged') {
    return t('logsPage.msg.retentionPurged', {
      count: String(d.deleted ?? r.summary ?? 0),
      table: (d.table as string) ?? '—',
      days: String(d.retention_days ?? '—'),
    })
  }
  if (r.action === 'retention.changed') {
    const days = (v: unknown) => (v == null ? '∞' : String(v))
    return t('logsPage.msg.retentionChanged', {
      audit: days(d.audit_retention_days),
      import: days(d.import_retention_days),
    })
  }
  // Notifikations-udfald (afsendelse/bounce): vis en LÆSBAR årsag i stedet for et
  // råt Resend/GatewayAPI-svar. Afsenderfunktionerne lægger en kort maskinkode i
  // detail.reason (classifySendError); et bounce lægger providerens tekst der.
  if (/[._](reminder_failed|reminder_bounced|reminder_complained|notification_bounced|notification_complained)$/.test(r.action)) {
    const reasonCodes: Record<string, string> = {
      invalid_email: t('logsPage.msg.reasonInvalidEmail'),
      invalid_phone: t('logsPage.msg.reasonInvalidPhone'),
      email_not_configured: t('logsPage.msg.reasonEmailNotConfigured'),
      sms_not_configured: t('logsPage.msg.reasonSmsNotConfigured'),
      email_error: t('logsPage.msg.reasonEmailError'),
      sms_error: t('logsPage.msg.reasonSmsError'),
    }
    const raw = typeof d.reason === 'string' ? d.reason : ''
    const reasonText = reasonCodes[raw] ?? raw ?? (typeof d.error === 'string' ? d.error : '')
    return [r.summary, reasonText].filter(Boolean).join('   ·   ')
  }
  const parts: string[] = []
  if (r.summary) parts.push(r.summary)
  if (d.from_status || d.to_status) parts.push(`${d.from_status ?? '—'} → ${d.to_status ?? '—'}`)
  // Ændringshændelser (udløb, sprog, valuta, …): vis fra → til fra detail.
  const fmtChange = (v: unknown): string => {
    if (v == null) return '—'
    if (Array.isArray(v)) return v.join(', ')
    const s = String(v)
    return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s
  }
  if (r.action.endsWith('_changed') && ('from' in d || 'to' in d))
    parts.push(`${fmtChange(d.from)} → ${fmtChange(d.to)}`)
  else if (d.valid_until) parts.push(`→ ${String(d.valid_until).slice(0, 10)}`)
  if (r.action.startsWith('import.'))
    parts.push(`+${d.created ?? 0} / ~${d.updated ?? 0} / -${d.deactivated ?? 0} / ✗${d.rejected ?? 0}`)
  return parts.join('   ·   ')
}

const GRID_BASE = 'grid items-center gap-3'

function LogsPage() {
  const { t, i18n } = useTranslation()
  const [live, setLive] = useState(false)
  const { data, isPending, refetch, isFetching } = useAuditLog(live)
  const { data: companyNames } = useCompanyNames()
  const { data: actorNames } = useActorNames()
  const [range, setRange] = useState('7d')
  const [actions, setActions] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<Set<string>>(new Set())
  const [levels, setLevels] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  // Valgt logpost → detaljerude under tabellen (som Supabase Studio).
  const [selectedId, setSelectedId] = useState<LogRow['id'] | null>(null)
  const [detailView, setDetailView] = useState<'text' | 'json'>('text')

  // Justerbare kolonnebredder — trækkes i kolonnekanten i headeren.
  const [widths, setWidths] = useState<number[]>(DEFAULT_WIDTHS)
  const drag = useRef<{ i: number; startX: number; startW: number } | null>(null)
  const startResize = (i: number, e: React.MouseEvent) => {
    e.preventDefault()
    drag.current = { i, startX: e.clientX, startW: widths[i] }
    const onMove = (ev: MouseEvent) => {
      const d = drag.current
      if (!d) return
      const next = Math.max(MIN_COL_WIDTH, d.startW + ev.clientX - d.startX)
      setWidths((prev) => prev.map((w, idx) => (idx === d.i ? next : w)))
    }
    const onUp = () => {
      drag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.userSelect = 'none'
  }
  // Hover-popup: vis fuld celleindhold når teksten er afkortet (ellipsis).
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const onCellEnter = (e: React.MouseEvent<HTMLElement>, text: string) => {
    const el = e.currentTarget
    if (el.scrollWidth > el.clientWidth + 1) {
      const rect = el.getBoundingClientRect()
      setTip({ x: rect.left, y: rect.bottom + 4, text })
    }
  }
  const hover = (text: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => onCellEnter(e, text),
    onMouseLeave: () => setTip(null),
  })

  // Tidsstempel-popup for Tidspunkt-kolonnen (vises altid ved hover).
  const [stamp, setStamp] = useState<{ x: number; y: number; ms: number } | null>(null)
  const stampProps = (ms: number) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      setStamp({ x: rect.left, y: rect.bottom + 4, ms })
    },
    onMouseLeave: () => setStamp(null),
  })
  const rtf = new Intl.RelativeTimeFormat(i18n.language || 'da', { numeric: 'auto' })

  // Sammenklappelige facet-sektioner (huskes i localStorage).
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    loadFlags(FACET_STORAGE_KEY),
  )
  const isOpen = (id: string) => openSections[id] !== false // standard: udfoldet
  const toggleSection = (id: string) =>
    setOpenSections((prev) => {
      const next = { ...prev, [id]: prev[id] === false }
      saveFlags(FACET_STORAGE_KEY, next)
      return next
    })

  // Kolonnesynlighed (huskes i localStorage). Standard: alle synlige.
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>(() =>
    loadFlags(COLUMN_STORAGE_KEY),
  )
  const isColVisible = (key: string) => visibleCols[key] !== false
  const toggleColumn = (key: string) =>
    setVisibleCols((prev) => {
      const next = { ...prev, [key]: prev[key] === false }
      saveFlags(COLUMN_STORAGE_KEY, next)
      return next
    })
  const colOrder = COLUMNS.filter((c) => isColVisible(c.key))
  const gridTemplateColumns = `16px ${colOrder
    .map((c) => (c.key === 'message' ? 'minmax(140px, 1fr)' : `${widths[COLUMNS.indexOf(c)]}px`))
    .join(' ')}`
  const section = (id: string, title: string, body: React.ReactNode) => (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => toggleSection(id)}
        className="flex w-full items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-muted-foreground"
        aria-expanded={isOpen(id)}
      >
        <span>{title}</span>
        {isOpen(id) ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>
      {isOpen(id) && <div className="flex flex-col gap-1.5">{body}</div>}
    </div>
  )

  const rows = data ?? []
  const now = Date.now()
  const rangeMs = RANGES.find((r) => r.key === range)?.ms ?? null
  const cutoff = rangeMs ? now - rangeMs : 0

  const timeFiltered = rows.filter((r) => new Date(r.created_at).getTime() >= cutoff)

  const companyName = (id: string | null) => (id ? (companyNames?.get(id) ?? '—') : '—')
  const actorName = (id: string | null) =>
    id ? (actorNames?.get(id) ?? `${id.slice(0, 8)}…`) : '—'

  // Facet-tællinger beregnes på det tidsfiltrerede sæt (uafhængigt af de øvrige
  // afkrydsninger), ligesom Supabase Studio.
  const actionCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of timeFiltered) m.set(r.action, (m.get(r.action) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range])

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of timeFiltered) {
      const c = categoryOf(r.action)
      m.set(c, (m.get(c) ?? 0) + 1)
    }
    return CATEGORIES.filter((c) => m.has(c)).map((c) => [c, m.get(c)!] as const)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range])

  const levelCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of timeFiltered) {
      const l = levelOf(r)
      m.set(l, (m.get(l) ?? 0) + 1)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, range])

  const q = query.trim().toLowerCase()
  const filtered = timeFiltered.filter((r) => {
    if (levels.size && !levels.has(levelOf(r))) return false
    if (categories.size && !categories.has(categoryOf(r.action))) return false
    if (actions.size && !actions.has(r.action)) return false
    if (
      q &&
      !`${r.action} ${companyName(r.company_id)} ${actorName(r.actor_user_id)} ${message(r, t)}`
        .toLowerCase()
        .includes(q)
    )
      return false
    return true
  })

  // Detaljerude: den valgte post (uanset filter, så udvalget overlever et
  // filterskift), dens fulde indhold som pæn JSON, og naboer til ↑/↓-navigation.
  const selectedRow =
    selectedId == null ? null : (rows.find((r) => r.id === selectedId) ?? null)
  const selectedJson = selectedRow
    ? JSON.stringify(
        {
          id: selectedRow.id,
          created_at: selectedRow.created_at,
          level: levelOf(selectedRow),
          category: categoryOf(selectedRow.action),
          action: selectedRow.action,
          company_id: selectedRow.company_id,
          company: companyName(selectedRow.company_id),
          actor_user_id: selectedRow.actor_user_id,
          actor: actorName(selectedRow.actor_user_id),
          entity_type: selectedRow.entity_type,
          entity_id: selectedRow.entity_id,
          summary: selectedRow.summary,
          message: message(selectedRow, t) || null,
          detail: selectedRow.detail,
        },
        null,
        2,
      )
    : ''
  // Læsbar «Tekst»-visning: navngivne felter + detail som nøgle/værdi.
  const selectedTextRows: [string, string][] = selectedRow
    ? [
        [t('logsPage.colDate'), dateFmt.format(new Date(selectedRow.created_at))],
        [t('logsPage.level'), t(LEVELS.find((l) => l.key === levelOf(selectedRow))?.labelKey ?? '')],
        [t('logsPage.category'), t(`logsPage.categories.${categoryOf(selectedRow.action)}`)],
        [t('logsPage.colAction'), selectedRow.action],
        [t('logsPage.colCompany'), companyName(selectedRow.company_id)],
        [t('logsPage.colActor'), actorName(selectedRow.actor_user_id)],
        [t('logsPage.colMessage'), message(selectedRow, t) || selectedRow.summary || '—'],
      ]
    : []
  const selectedDetailEntries: [string, string][] = selectedRow
    ? Object.entries((selectedRow.detail ?? {}) as Record<string, unknown>).map(([k, v]) => [
        k,
        v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v),
      ])
    : []
  const selectedText = [...selectedTextRows, ...selectedDetailEntries]
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  const selIndex = selectedId == null ? -1 : filtered.findIndex((r) => r.id === selectedId)
  const gotoRel = (delta: number) => {
    if (selIndex < 0) return
    const next = filtered[selIndex + delta]
    if (next) setSelectedId(next.id)
  }

  const times = filtered.map((r) => new Date(r.created_at).getTime())
  const hiMax = rangeMs ? now : times.length ? Math.max(...times) : now
  const hiMin = rangeMs ? cutoff : times.length ? Math.min(...times) : now - 1
  const span = Math.max(1, hiMax - hiMin)
  // Hver søjle bærer sin egen niveau-opdeling + starttidspunkt, så vi kan vise
  // en Studio-lignende popup (Fejl/Advarsel/Succes) ved hover.
  const buckets = Array.from({ length: BUCKETS }, (_, i) => ({
    count: 0,
    success: 0,
    warning: 0,
    error: 0,
    t0: hiMin + (i * span) / BUCKETS,
  }))
  for (const r of filtered) {
    const i = Math.min(
      BUCKETS - 1,
      Math.max(0, Math.floor(((new Date(r.created_at).getTime() - hiMin) / span) * BUCKETS)),
    )
    const b = buckets[i]
    b.count++
    b[levelOf(r)]++
  }
  const bucketMax = Math.max(1, ...buckets.map((b) => b.count))

  // X-akse: klokkeslæt for korte tidsrum (≤ 24t), ellers dato.
  const axisAsTime = rangeMs != null && rangeMs <= DAY_MS
  const axisLabel = (t0: number) => (axisAsTime ? axisTimeFmt : axisDateFmt).format(new Date(t0))

  const toggle =
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (key: string, on: boolean) =>
      setter((prev) => {
        const next = new Set(prev)
        if (on) next.add(key)
        else next.delete(key)
        return next
      })
  const toggleAction = toggle(setActions)
  const toggleCategory = toggle(setCategories)
  const toggleLevel = toggle(setLevels)

  // Celleværdi pr. kolonne (deles af tabelrækkerne og CSV-eksporten).
  const cellValue = (r: LogRow, key: string): string => {
    switch (key) {
      case 'date':
        return dateFmt.format(new Date(r.created_at))
      case 'action':
        return r.action
      case 'category':
        return t(`logsPage.categories.${categoryOf(r.action)}`)
      case 'company':
        return companyName(r.company_id)
      case 'actor':
        return actorName(r.actor_user_id)
      case 'message':
        return message(r, t) || '—'
      default:
        return ''
    }
  }

  // CSV-eksport af den aktuelle (filtrerede) visning — kun de synlige kolonner.
  const downloadLogs = () => {
    const cols = colOrder.length ? colOrder : COLUMNS
    const csvCell = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = cols.map((c) => csvCell(t(c.labelKey))).join(',')
    const body = filtered.map((r) =>
      cols.map((c) => csvCell(c.key === 'message' ? message(r, t) || '' : cellValue(r, c.key))).join(','),
    )
    const csv = [header, ...body].join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `operia-logs-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex min-h-full flex-col gap-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-medium">{t('nav.operiaLogs')}</h1>
        </div>
        <div className="flex items-center gap-1">
          <TooltipProvider delayDuration={300}>
            {/* Genindlæs */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => refetch()}
                  aria-label={t('logsPage.refreshLogs')}
                >
                  <span className={cn('inline-flex', isFetching && 'animate-spin')}>
                    <RefreshCw size={16} animateOnHover />
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('logsPage.refreshLogs')}</TooltipContent>
            </Tooltip>

            {/* Kolonnesynlighed */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      aria-label={t('logsPage.toggleColumns')}
                    >
                      <Columns3 size={16} animateOnHover />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('logsPage.toggleColumns')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>{t('logsPage.columns')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLUMNS.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.key}
                    checked={isColVisible(c.key)}
                    onCheckedChange={() => toggleColumn(c.key)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {t(c.labelKey)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Download */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={downloadLogs}
                  aria-label={t('logsPage.downloadLogs')}
                >
                  <Download size={16} animateOnHover />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('logsPage.downloadLogs')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Button
            variant={live ? 'default' : 'outline'}
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => setLive((v) => !v)}
          >
            <span
              className={cn(
                'inline-block size-1.5 rounded-full',
                live ? 'animate-pulse bg-emerald-400' : 'bg-muted-foreground',
              )}
            />
            {t('logsPage.live')}
          </Button>
        </div>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('logsPage.searchPlaceholder')}
        className="h-8"
      />

      <div className="flex h-14 items-end gap-px rounded-md border bg-muted/20 p-2">
        {buckets.map((b, i) => (
          <div key={i} className="group relative flex h-full flex-1 flex-col justify-end">
            {LEVELS.map((l) =>
              b[l.key] ? (
                <div
                  key={l.key}
                  className={cn('w-full', l.color)}
                  style={{ height: `${(b[l.key] / bucketMax) * 100}%`, minHeight: 2 }}
                />
              ) : null,
            )}
            {b.count > 0 && (
              <div
                className={cn(
                  'pointer-events-none absolute bottom-full z-20 mb-1 hidden w-max min-w-40 rounded-md border bg-popover p-2 shadow-md group-hover:block',
                  i < BUCKETS / 2 ? 'left-0' : 'right-0',
                )}
              >
                <p className="mb-1 text-[11px] font-medium text-foreground">
                  {bucketFmt.format(new Date(b.t0))}
                </p>
                <div className="flex flex-col gap-0.5">
                  {[...LEVELS].reverse().map((l) => (
                    <div key={l.key} className="flex items-center gap-2 text-[11px]">
                      <span className={cn('size-2 rounded-[3px]', l.color)} />
                      <span className="flex-1 text-muted-foreground">{t(l.labelKey)}</span>
                      <span className="tabular-nums text-foreground">{b[l.key]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* X-akse: samme flex/gap/px-2 som søjlerne, så hver etiket flugter
          præcist med sin søjle. Én etiket for hver AXIS_STEP søjle. */}
      <div className="-mt-2 flex h-4 gap-px px-2">
        {buckets.map((b, i) => (
          <div key={i} className="relative min-w-0 flex-1">
            {i % AXIS_STEP === 0 && i <= BUCKETS - 2 && (
              <span className="absolute left-0 top-0 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground/70">
                {axisLabel(b.t0)}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="w-52 shrink-0 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {t('logsPage.timeRange')}
            </p>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {t(r.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {section(
            'level',
            t('logsPage.level'),
            LEVELS.map((l) => (
              <label key={l.key} className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox
                  checked={levels.has(l.key)}
                  onCheckedChange={(v) => toggleLevel(l.key, v === true)}
                />
                <span className={cn('size-2 rounded-[3px]', l.color)} />
                <span className="flex-1 truncate">{t(l.labelKey)}</span>
                <span className="text-muted-foreground">{levelCounts.get(l.key) ?? 0}</span>
              </label>
            )),
          )}

          {section(
            'category',
            t('logsPage.category'),
            <>
              {categoryCounts.map(([cat, count]) => (
                <label key={cat} className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    checked={categories.has(cat)}
                    onCheckedChange={(v) => toggleCategory(cat, v === true)}
                  />
                  <span className="flex-1 truncate">{t(`logsPage.categories.${cat}`)}</span>
                  <span className="text-muted-foreground">{count}</span>
                </label>
              ))}
              {!categoryCounts.length && <p className="text-xs text-muted-foreground">—</p>}
            </>,
          )}

          {section(
            'action',
            t('logsPage.eventType'),
            <>
              {actionCounts.map(([action, count]) => (
                <label key={action} className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    checked={actions.has(action)}
                    onCheckedChange={(v) => toggleAction(action, v === true)}
                  />
                  <span className="flex-1 truncate font-mono text-[11px]">{action}</span>
                  <span className="text-muted-foreground">{count}</span>
                </label>
              ))}
              {!actionCounts.length && <p className="text-xs text-muted-foreground">—</p>}
            </>,
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="overflow-hidden rounded-md border">
              <div
                className={cn(
                  GRID_BASE,
                  'border-b bg-muted/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70',
                )}
                style={{ gridTemplateColumns }}
              >
                <span />
                {colOrder.map((c) => (
                  <span key={c.key} className="relative select-none truncate">
                    {t(c.labelKey)}
                    {c.key !== 'message' && (
                      <span
                        onMouseDown={(e) => startResize(COLUMNS.indexOf(c), e)}
                        className="group/resize absolute -right-2 top-0 z-10 flex h-full w-4 cursor-col-resize items-center justify-center"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={t('logsPage.resizeColumn')}
                      >
                        <span className="h-3 w-px bg-border group-hover/resize:bg-foreground" />
                      </span>
                    )}
                  </span>
                ))}
              </div>
              <div
                className={cn(
                  'overflow-y-auto',
                  // Gør plads til detaljeruden (h-72) når en post er valgt.
                  selectedRow ? 'max-h-[calc(100svh-41rem)]' : 'max-h-[calc(100svh-22rem)]',
                )}
              >
                {filtered.map((r) => {
                  const ms = new Date(r.created_at).getTime()
                  const cellClass: Record<string, string> = {
                    date: 'cursor-help truncate font-mono text-[11px] text-muted-foreground',
                    action: 'truncate font-mono text-[11px]',
                    category: 'truncate text-muted-foreground',
                    company: 'truncate text-muted-foreground',
                    actor: 'truncate text-muted-foreground',
                    message: 'truncate',
                  }
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedId((prev) => (prev === r.id ? null : r.id))}
                      className={cn(
                        GRID_BASE,
                        'cursor-pointer border-b border-border/50 px-3 py-1.5 text-xs hover:bg-muted/40',
                        selectedId === r.id && 'bg-accent',
                      )}
                      style={{ gridTemplateColumns }}
                    >
                      <span className={cn('size-1.5 rounded-full', levelColor(levelOf(r)))} />
                      {colOrder.map((c) => {
                        const text = cellValue(r, c.key)
                        return (
                          <span
                            key={c.key}
                            className={cellClass[c.key]}
                            {...(c.key === 'date' ? stampProps(ms) : hover(text))}
                          >
                            {text}
                          </span>
                        )
                      })}
                    </div>
                  )
                })}
                {!filtered.length && (
                  <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                    {t('logsPage.empty')}
                  </p>
                )}
              </div>
              <div className="border-t bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                {t('logsPage.count', { count: filtered.length })}
              </div>
            </div>
          )}

          {selectedRow && (
            <div className="flex h-72 shrink-0 flex-col overflow-hidden rounded-md border bg-panel">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5">
                <div className="flex items-center gap-3">
                  {(['text', 'json'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDetailView(v)}
                      className={cn(
                        'cursor-pointer text-[11px] font-medium uppercase tracking-wider transition-colors',
                        detailView === v
                          ? 'text-foreground'
                          : 'text-muted-foreground/70 hover:text-foreground',
                      )}
                    >
                      {v === 'text' ? t('logsPage.viewText') : t('logsPage.rawJson')}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    disabled={selIndex <= 0}
                    onClick={() => gotoRel(-1)}
                    aria-label={t('logsPage.detailPrev')}
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    disabled={selIndex < 0 || selIndex >= filtered.length - 1}
                    onClick={() => gotoRel(1)}
                    aria-label={t('logsPage.detailNext')}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                  <CopyButton
                    value={detailView === 'text' ? selectedText : selectedJson}
                    label={t('logsPage.copyJson')}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedId(null)}
                    aria-label={t('logsPage.closeDetail')}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3">
                {detailView === 'json' ? (
                  <div className="font-mono text-xs leading-5">
                    {selectedJson.split('\n').map((line, i) => (
                      <div key={i} className="grid grid-cols-[3ch_1fr] gap-3">
                        <span className="select-none text-right tabular-nums text-muted-foreground/40">
                          {i + 1}
                        </span>
                        <span className="whitespace-pre-wrap break-all text-foreground">{line}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 text-xs">
                    <div className="flex flex-col gap-1">
                      {selectedTextRows.map(([k, v]) => (
                        <div key={k} className="flex gap-3">
                          <span className="w-28 shrink-0 text-muted-foreground">{k}</span>
                          <span className="flex-1 break-words text-foreground">{v}</span>
                        </div>
                      ))}
                    </div>
                    {selectedDetailEntries.length > 0 && (
                      <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
                        {selectedDetailEntries.map(([k, v]) => (
                          <div key={k} className="flex gap-3">
                            <span className="w-28 shrink-0 font-mono text-muted-foreground">{k}</span>
                            <span className="flex-1 whitespace-pre-wrap break-words text-foreground">
                              {v}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {tip && (
        <div
          className="pointer-events-none fixed z-50 max-w-lg whitespace-normal break-words rounded-md border bg-popover px-2 py-1 text-xs text-foreground shadow-md"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      )}

      {stamp && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border bg-popover px-3 py-2 text-[11px] shadow-md"
          style={{ left: stamp.x, top: stamp.y }}
        >
          <div className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-1">
            <span className="text-muted-foreground">UTC</span>
            <span className="text-right font-mono tabular-nums text-foreground">
              {fmtStamp(tsUtcFmt, stamp.ms)}
            </span>
            <span className="text-muted-foreground">{localTimeZone}</span>
            <span className="text-right font-mono tabular-nums text-foreground">
              {fmtStamp(tsLocalFmt, stamp.ms)}
            </span>
            <span className="text-muted-foreground">{t('logsPage.tsRelative')}</span>
            <span className="text-right text-foreground">{relativeTime(stamp.ms, now, rtf)}</span>
            <span className="text-muted-foreground">{t('logsPage.tsTimestamp')}</span>
            <span className="text-right font-mono tabular-nums text-foreground">{stamp.ms}</span>
          </div>
        </div>
      )}
    </div>
  )
}

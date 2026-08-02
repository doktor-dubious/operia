import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Package,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ParcelStatusBadge,
  statusColor,
  statusLabelKey,
  type ParcelStatus,
} from '@/components/parcel-status-badge'
import { ParcelSummary, type ParcelSummaryData } from '@/components/parcel-summary'
import { ScannerIndicator } from '@/components/scanner-indicator'
import { normalizeScan, useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'
import { describeError } from '@/lib/errors'
import { isTerminalStatus, WINDOWS, windowLabelKey } from '@/lib/parcel-board'
import { cn } from '@/lib/utils'

// Pakkerne i ÉN kategori — det man lander på når man klikker et lagkagestykke
// eller en kasse på pakkeoversigten. Bygget til mange pakker:
//   • kun den valgte status hentes (afsluttede kun inden for tidsvinduet),
//   • nyeste først, sideinddelt, så skærmen ikke render tusinder af kasser,
//   • batch-modtagelser vises som ÉT ikon (standard), da 25 pakker til samme
//     person ellers fylder hele siden; kan slås om til enkeltvisning,
//   • søgefeltet er både stregkodescanning (som Søg-siden) og fritekstfilter
//     på modtager, afdeling, placering og batch-kode.

const PAGE_SIZE = 48
const MAX_PAGE_BUTTONS = 5
// Loftet er en beskyttelse, ikke en visning: rammer en kategori det, siger vi
// det højt i stedet for stiltiende at skjule resten (søg/periode indsnævrer).
const MAX_ROWS = 2000

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

type ListParcel = ParcelSummaryData & {
  status: ParcelStatus
  activityAt: string
  batchId: string | null
  batchCode: string | null
}

type Item =
  | { kind: 'parcel'; key: string; activityAt: string; parcel: ListParcel }
  | {
      kind: 'batch'
      key: string
      activityAt: string
      batchId: string
      batchCode: string | null
      receiverName: string | null
      departmentName: string | null
      members: ListParcel[]
    }

const PARCEL_COLUMNS = `id, barcode, status, registered_at, delivered_at, delivered_to, updated_at,
   sender, condition_note, condition_photo_path, batch_id,
   receiver_override_reason, receiver_override_at, removed_reason, removed_at,
   receiver:employees!parcels_receiver_employee_id_fkey (full_name),
   delivered_employee:employees!parcels_delivered_employee_id_fkey (full_name),
   department:departments (name),
   location:storage_locations (name),
   batch:parcel_batches (batch_code)`

type ParcelRow = {
  id: string
  barcode: string | null
  status: ParcelStatus
  registered_at: string
  delivered_at: string | null
  delivered_to: string | null
  updated_at: string | null
  sender: string | null
  condition_note: string | null
  condition_photo_path: string | null
  batch_id: string | null
  receiver_override_reason: string | null
  receiver_override_at: string | null
  removed_reason: string | null
  removed_at: string | null
  receiver: { full_name: string } | null
  delivered_employee: { full_name: string } | null
  department: { name: string } | null
  location: { name: string } | null
  batch: { batch_code: string | null } | null
}

const toListParcel = (d: ParcelRow): ListParcel => ({
  id: d.id,
  barcode: d.barcode,
  status: d.status,
  receiverName: d.receiver?.full_name ?? null,
  departmentName: d.department?.name ?? null,
  locationName: d.location?.name ?? null,
  registeredAt: d.registered_at,
  deliveredTo: d.delivered_to,
  sender: d.sender,
  conditionNote: d.condition_note,
  conditionPhotoPath: d.condition_photo_path,
  overrideReason: d.receiver_override_reason,
  overrideAt: d.receiver_override_at,
  removedReason: d.removed_reason,
  removedAt: d.removed_at,
  deliveredEmployeeName: d.delivered_employee?.full_name ?? null,
  batchId: d.batch_id,
  batchCode: d.batch?.batch_code ?? null,
  // "Aktivitet" = da pakken blev afsluttet, ellers da den blev modtaget.
  activityAt: d.delivered_at ?? d.updated_at ?? d.registered_at,
})

function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])
  return [value, setValue] as const
}

export function ParcelStatusList({
  status,
  hours,
  onHoursChange,
}: {
  status: ParcelStatus
  // Tidsvindue for afsluttede kategorier (timer; 0 = alle). Ignoreres for de
  // aktive statusser, hvor "nu" altid er hele sandheden.
  hours: number
  onHoursChange: (hours: number) => void
}) {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const terminal = isTerminalStatus(status)

  const [grouped, setGrouped] = usePersisted('operia-board-group-batches', true)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [scanSignal, setScanSignal] = useState(0)
  const [active, setActive] = useState<ListParcel | null>(null)
  const [openBatch, setOpenBatch] = useState<{ id: string; code: string | null } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const { data, isPending } = useQuery({
    // Nøglen starter med 'parcels', så pakkeskærmenes invalideringer og
    // realtime-lytteren også opdaterer denne liste.
    queryKey: ['parcels', 'board-list', companyId, status, terminal ? hours : 'open'],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase
        .from('parcels')
        .select(PARCEL_COLUMNS)
        .eq('company_id', companyId!)
        .eq('status', status)
      if (terminal) {
        if (hours > 0) {
          q = q.gte('updated_at', new Date(Date.now() - hours * 3600 * 1000).toISOString())
        }
        q = q.order('updated_at', { ascending: false })
      } else {
        q = q.order('registered_at', { ascending: false })
      }
      const { data, error } = await q.limit(MAX_ROWS)
      if (error) throw error
      return (data as unknown as ParcelRow[]).map(toListParcel)
    },
  })

  const parcels = useMemo(() => data ?? [], [data])

  // Fritekstfilter — modtager, afdeling, placering, stregkode, batch-kode.
  const filtered = useMemo(() => {
    const q = normalizeScan(query).toLowerCase()
    if (!q) return parcels
    return parcels.filter((p) =>
      [p.barcode, p.receiverName, p.departmentName, p.locationName, p.batchCode, p.deliveredTo]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [parcels, query])

  // Grupper batch-modtagelser. En batch der kun bidrager med ÉN pakke i denne
  // visning vises som en almindelig pakke (der er intet at folde sammen) — men
  // beholder sit batch-mærke, så sammenhængen ikke forsvinder.
  const items = useMemo<Item[]>(() => {
    if (!grouped) {
      return filtered.map((p) => ({
        kind: 'parcel' as const,
        key: p.id,
        activityAt: p.activityAt,
        parcel: p,
      }))
    }
    const batches = new Map<string, ListParcel[]>()
    const singles: ListParcel[] = []
    for (const p of filtered) {
      if (!p.batchId) {
        singles.push(p)
        continue
      }
      const list = batches.get(p.batchId)
      if (list) list.push(p)
      else batches.set(p.batchId, [p])
    }
    const out: Item[] = singles.map((p) => ({
      kind: 'parcel' as const,
      key: p.id,
      activityAt: p.activityAt,
      parcel: p,
    }))
    for (const [batchId, members] of batches) {
      if (members.length === 1) {
        out.push({
          kind: 'parcel',
          key: members[0].id,
          activityAt: members[0].activityAt,
          parcel: members[0],
        })
        continue
      }
      out.push({
        kind: 'batch',
        key: `batch-${batchId}`,
        // Batchens plads i rækkefølgen = dens nyeste pakke.
        activityAt: members.reduce((a, b) => (a > b.activityAt ? a : b.activityAt), ''),
        batchId,
        batchCode: members[0].batchCode,
        receiverName: members[0].receiverName,
        departmentName: members[0].departmentName,
        members,
      })
    }
    return out.sort((a, b) => (a.activityAt < b.activityAt ? 1 : a.activityAt > b.activityAt ? -1 : 0))
  }, [filtered, grouped])

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const pageButtons = useMemo(() => {
    const start = Math.max(
      1,
      Math.min(safePage - Math.floor(MAX_PAGE_BUTTONS / 2), pageCount - MAX_PAGE_BUTTONS + 1),
    )
    const end = Math.min(pageCount, start + MAX_PAGE_BUTTONS - 1)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }, [safePage, pageCount])

  // Scanning: stregkoden slår direkte op i den viste kategori — en pakke åbner
  // sit visitkort, en batch-label åbner batchen. Ingen træffer ⇒ sig det, i
  // stedet for at efterlade et tomt filter uden forklaring.
  useBarcodeScanner({
    targetRef: searchRef,
    onScan: (code) => {
      const q = normalizeScan(code)
      setQuery(q)
      setPage(1)
      setScanSignal((n) => n + 1)
      const lower = q.toLowerCase()
      const parcelHit = parcels.find((p) => (p.barcode ?? '').toLowerCase() === lower)
      if (parcelHit) {
        setActive(parcelHit)
        return
      }
      const batchHit = parcels.find((p) => (p.batchCode ?? '').toLowerCase() === lower)
      if (batchHit?.batchId) {
        setOpenBatch({ id: batchHit.batchId, code: batchHit.batchCode })
        return
      }
      toast.info(t('board.scanNoMatch', { code: q, status: t(statusLabelKey[status]) }))
    },
  })

  return (
    <div className="flex flex-col gap-4">
      {/* Sidehoved: tilbage til oversigten + hvad man ser på. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
          <Link to="/parcels/board" search={{}}>
            <ArrowLeft className="size-3.5" /> {t('board.backToOverview')}
          </Link>
        </Button>
        <span className="flex items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor[status] }}
          />
          <span className="text-[14px] font-medium">{t(statusLabelKey[status])}</span>
          {!isPending && (
            <span className="text-[13px] text-muted-foreground">
              {t('board.parcelCount', { count: filtered.length })}
            </span>
          )}
        </span>

        {/* Tidsvindue — kun relevant for de afsluttede kategorier. */}
        {terminal && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 cursor-pointer px-2 text-xs text-muted-foreground hover:text-foreground"
                aria-label={t('board.windowLabel')}
              >
                <Clock className="size-3.5" /> {t(windowLabelKey(hours))}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {WINDOWS.map((h) => (
                <DropdownMenuItem
                  key={h}
                  className="cursor-pointer"
                  onClick={() => {
                    onHoursChange(h)
                    setPage(1)
                  }}
                >
                  <Check className={cn('size-4', hours === h ? 'opacity-100' : 'opacity-0')} />
                  {t(windowLabelKey(h))}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Værktøjslinje: batchvisning til venstre, søg/scan til højre. Bundlinjen
          flugter, så knapperne står på linje med selve søgefeltet. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="inline-flex rounded-md border border-border p-0.5" role="group">
          {(
            [
              { value: true, labelKey: 'board.batchesGrouped', icon: Boxes },
              { value: false, labelKey: 'board.batchesIndividual', icon: Package },
            ] as const
          ).map(({ value, labelKey, icon: Icon }) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={grouped === value}
              onClick={() => {
                setGrouped(value)
                setPage(1)
              }}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-xs transition-colors',
                grouped === value
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" /> {t(labelKey)}
            </button>
          ))}
        </div>

        {/* Scanner-markøren står OVER feltet — samme rækkefølge som Modtag og
            Udlevér, hvor den sidder i linjen med feltets etiket. */}
        <div className="flex flex-1 flex-col gap-2 sm:max-w-sm">
          <div className="flex justify-end">
            <ScannerIndicator signal={scanSignal} />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              autoFocus
              autoComplete="off"
              aria-label={t('board.filterLabel')}
              placeholder={t('board.filterPlaceholder')}
              className="h-8 pl-8 text-xs"
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
            />
          </div>
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <section className="rounded-lg border border-border bg-panel">
          <div className="p-3">
            {items.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {query ? t('board.noMatches') : t('board.empty')}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {pageItems.map((item) =>
                  item.kind === 'batch' ? (
                    <BatchTile
                      key={item.key}
                      item={item}
                      onOpen={() => setOpenBatch({ id: item.batchId, code: item.batchCode })}
                    />
                  ) : (
                    <ParcelTile
                      key={item.key}
                      parcel={item.parcel}
                      onOpen={() => setActive(item.parcel)}
                    />
                  ),
                )}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
              {/* Med batches samlet er antallet af FELTER ikke antallet af pakker
                  — så begge tal står der, ellers ser det ud som om pakker mangler. */}
              <span className="text-xs text-muted-foreground">
                {t('board.showing', {
                  from: (safePage - 1) * PAGE_SIZE + 1,
                  to: Math.min(safePage * PAGE_SIZE, items.length),
                  total: items.length,
                })}
                {items.length !== filtered.length &&
                  ` · ${t('board.parcelCount', { count: filtered.length })}`}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                >
                  <ChevronLeft className="size-3.5" /> {t('dataTable.previous')}
                </Button>
                {pageButtons.map((n) => (
                  <Button
                    key={n}
                    variant={n === safePage ? 'outline' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0 text-xs"
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage(safePage + 1)}
                >
                  {t('dataTable.next')} <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {parcels.length >= MAX_ROWS && (
        <p className="text-xs text-status-neutral-to-bad">
          {t('board.capped', { count: MAX_ROWS })}
        </p>
      )}

      {/* Klik på en pakke → samme visitkort som Søg og den gamle tavle viste. */}
      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('board.parcelTitle')}</DialogTitle>
          </DialogHeader>
          {active && <ParcelSummary parcel={active} onRemoved={() => setActive(null)} />}
        </DialogContent>
      </Dialog>

      {/* Klik på en batch → alle pakker i batchen (også dem i anden status). */}
      <BatchDialog
        batch={openBatch}
        companyId={companyId}
        onOpenChange={(open) => !open && setOpenBatch(null)}
        onPick={setActive}
      />
    </div>
  )
}

// --- Fliser ---

function ParcelTile({ parcel, onOpen }: { parcel: ListParcel; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          className="flex cursor-pointer flex-col gap-1 rounded-md border border-border bg-background/50 p-3 text-left transition-colors hover:border-foreground/25 hover:bg-accent/50"
        >
          <span className="flex items-center gap-1.5">
            {parcel.batchId && (
              <Boxes className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="truncate text-[14px] font-medium">
              {parcel.receiverName ?? t('board.noReceiver')}
            </span>
          </span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {parcel.barcode ?? '—'}
          </span>
          {/* Tredje linje: hvor pakken står — eller, når den er afsluttet, hvem
              der kvitterede. Placeringen ryddes ved udlevering/retur. */}
          {(parcel.deliveredTo ?? parcel.locationName) && (
            <span className="truncate text-[11px] text-muted-foreground">
              {parcel.deliveredTo ?? parcel.locationName}
            </span>
          )}
        </button>
      </TooltipTrigger>
      {/* Tooltip-fladen er inverteret (bg-foreground/text-background), så
          etiketterne dæmpes med text-background/70 — ikke muted-foreground. */}
      <TooltipContent side="top" className="max-w-xs flex-col items-start">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-background/70">{t('parcels.receiver')}</dt>
          <dd>{parcel.receiverName ?? '—'}</dd>
          <dt className="text-background/70">{t('parcels.barcode')}</dt>
          <dd className="font-mono">{parcel.barcode ?? '—'}</dd>
          <dt className="text-background/70">{t('parcels.department')}</dt>
          <dd>{parcel.departmentName ?? '—'}</dd>
          <dt className="text-background/70">{t('parcels.location')}</dt>
          <dd>{parcel.locationName ?? '—'}</dd>
          <dt className="text-background/70">{t('parcels.registeredAt')}</dt>
          <dd>{dateFormat.format(new Date(parcel.registeredAt))}</dd>
          {/* Manager-override: den faktiske modtager står ved siden af den
              tilsigtede, så en afveget kæde ikke først opdages i dialogen. */}
          {parcel.overrideReason && (
            <>
              <dt className="text-background/70">{t('override.actualReceiver')}</dt>
              <dd>{parcel.deliveredEmployeeName ?? parcel.deliveredTo ?? '—'}</dd>
            </>
          )}
          {parcel.batchCode && (
            <>
              <dt className="text-background/70">{t('board.batch')}</dt>
              <dd className="font-mono">{parcel.batchCode}</dd>
            </>
          )}
        </dl>
      </TooltipContent>
    </Tooltip>
  )
}

function BatchTile({
  item,
  onOpen,
}: {
  item: Extract<Item, { kind: 'batch' }>
  onOpen: () => void
}) {
  const { t } = useTranslation()
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          className="relative flex cursor-pointer items-center gap-2.5 rounded-md border border-dashed border-border bg-background/50 p-3 text-left transition-colors hover:border-foreground/25 hover:bg-accent/50"
        >
          {/* Antallet sidder i flisens hjørne, ikke oven i navnet. */}
          <span className="absolute right-1.5 top-1.5 rounded-full bg-foreground px-1.5 text-[10px] font-medium leading-4 text-background">
            {item.members.length}
          </span>
          <Boxes className="size-6 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex min-w-0 flex-col pr-5">
            <span className="truncate text-[14px] font-medium">
              {item.receiverName ?? t('board.noReceiver')}
            </span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {item.batchCode ?? '—'}
            </span>
          </span>
        </button>
      </TooltipTrigger>
      {/* Tooltip-fladen er inverteret (bg-foreground/text-background), så
          etiketterne dæmpes med text-background/70 — ikke muted-foreground. */}
      <TooltipContent side="top" className="max-w-xs flex-col items-start">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-background/70">{t('board.batch')}</dt>
          <dd className="font-mono">{item.batchCode ?? '—'}</dd>
          <dt className="text-background/70">{t('parcels.receiver')}</dt>
          <dd>{item.receiverName ?? '—'}</dd>
          <dt className="text-background/70">{t('parcels.department')}</dt>
          <dd>{item.departmentName ?? '—'}</dd>
          <dt className="text-background/70">{t('board.batchCountLabel')}</dt>
          <dd>{t('board.parcelCount', { count: item.members.length })}</dd>
        </dl>
      </TooltipContent>
    </Tooltip>
  )
}

// --- Batchdialog ---

function BatchDialog({
  batch,
  companyId,
  onOpenChange,
  onPick,
}: {
  batch: { id: string; code: string | null } | null
  companyId: string | null
  onOpenChange: (open: boolean) => void
  onPick: (parcel: ListParcel) => void
}) {
  const { t } = useTranslation()

  // Hele batchen hentes her — også medlemmer der har forladt den viste status
  // (fx allerede udleverede), for dialogen skal vise batchen som den er.
  const { data, isPending, error } = useQuery({
    queryKey: ['parcels', 'batch-members', companyId, batch?.id],
    enabled: !!companyId && !!batch,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parcels')
        .select(PARCEL_COLUMNS)
        .eq('company_id', companyId!)
        .eq('batch_id', batch!.id)
        .order('registered_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data as unknown as ParcelRow[]).map(toListParcel)
    },
  })

  return (
    <Dialog open={!!batch} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">
            {batch?.code ?? t('board.batch')}
          </DialogTitle>
          <DialogDescription>
            {isPending
              ? t('common.loading')
              : // En batch har præcis én modtager — den hører i overskriften.
                [data?.[0]?.receiverName, t('board.parcelCount', { count: data?.length ?? 0 })]
                  .filter(Boolean)
                  .join(' · ')}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-xs text-status-neutral-to-bad">{describeError(error, t)}</p>
        ) : isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <ul className="flex flex-col gap-1">
            {(data ?? []).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-md border border-border bg-background/50 px-3 py-2 text-left transition-colors hover:border-foreground/25 hover:bg-accent/50"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mono text-xs">{p.barcode ?? '—'}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {p.locationName ?? p.receiverName ?? '—'}
                    </span>
                  </span>
                  <ParcelStatusBadge status={p.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

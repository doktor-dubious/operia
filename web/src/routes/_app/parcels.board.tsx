import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronRight, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { statusColor, statusLabelKey, type ParcelStatus } from '@/components/parcel-status-badge'
import { ParcelSummary, type ParcelSummaryData } from '@/components/parcel-summary'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/parcels/board')({
  component: BoardPage,
})

// Pakkeoversigt: alle pakker som kasser med modtagerens navn, grupperet i én
// sektion pr. status. Tænkt som den lettilgængelige oversigt (moderne tilstand)
// frem for tabellen på /parcels. Sektioner kan foldes sammen; de afsluttede
// (udleveret/afvist/returneret) viser kun de seneste 24 timer, indstilleligt
// pr. sektion via ur-ikonet.

const OPEN_STATUSES: ParcelStatus[] = [
  'unassigned',
  'registered',
  'in_storage',
  'in_transit',
  'in_locker',
]
const TERMINAL_STATUSES: ParcelStatus[] = ['delivered', 'rejected', 'returned']
const SECTIONS: ParcelStatus[] = [...OPEN_STATUSES, ...TERMINAL_STATUSES]

// Tidsvinduer for de afsluttede sektioner (timer; 0 = vis alle).
const WINDOWS = [24, 168, 720, 0] as const
const DEFAULT_WINDOW = 24
const windowLabelKey = (h: number) =>
  h === 24 ? 'board.window24h' : h === 168 ? 'board.window7d' : h === 720 ? 'board.window30d' : 'board.windowAll'

type BoardParcel = ParcelSummaryData & {
  status: ParcelStatus
  activityAt: string
}

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

function BoardPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()

  const [collapsed, setCollapsed] = usePersisted<string[]>('operia-board-collapsed', [])
  const [windows, setWindows] = usePersisted<Record<string, number>>('operia-board-windows', {})
  const [active, setActive] = useState<BoardParcel | null>(null)

  const windowFor = (status: ParcelStatus) => windows[status] ?? DEFAULT_WINDOW
  const anyAll = TERMINAL_STATUSES.some((s) => windowFor(s) === 0)
  const widest = Math.max(...TERMINAL_STATUSES.map((s) => windowFor(s)))

  const { data, isPending } = useQuery({
    // Nøglen starter med 'parcels', så de eksisterende invalideringer (og
    // realtime) også opdaterer oversigten.
    queryKey: ['parcels', 'board', companyId, anyAll ? 'all' : widest],
    enabled: !!companyId,
    queryFn: async () => {
      const columns = `id, barcode, status, registered_at, delivered_at, delivered_to, updated_at,
           condition_note, condition_photo_path,
           receiver:employees (full_name),
           department:departments (name),
           location:storage_locations (name)`
      // To adskilte forespørgsler frem for ét or()-filter: de åbne pakker hentes
      // altid, de afsluttede kun inden for det bredeste valgte vindue.
      const openQuery = supabase
        .from('parcels')
        .select(columns)
        .eq('company_id', companyId!)
        .in('status', OPEN_STATUSES)
        .order('registered_at', { ascending: false })
        .limit(2000)
      let doneQuery = supabase
        .from('parcels')
        .select(columns)
        .eq('company_id', companyId!)
        .in('status', TERMINAL_STATUSES)
        .order('updated_at', { ascending: false })
        .limit(2000)
      if (!anyAll) {
        doneQuery = doneQuery.gte(
          'updated_at',
          new Date(Date.now() - widest * 3600 * 1000).toISOString(),
        )
      }
      const [openRes, doneRes] = await Promise.all([openQuery, doneQuery])
      if (openRes.error) throw openRes.error
      if (doneRes.error) throw doneRes.error
      return [...openRes.data, ...doneRes.data].map<BoardParcel>((d) => ({
        id: d.id,
        barcode: d.barcode,
        status: d.status,
        receiverName: d.receiver?.full_name ?? null,
        departmentName: d.department?.name ?? null,
        locationName: d.location?.name ?? null,
        registeredAt: d.registered_at,
        deliveredTo: d.delivered_to,
        conditionNote: d.condition_note,
        conditionPhotoPath: d.condition_photo_path,
        // "Aktiv" for en afsluttet pakke = da den blev afsluttet.
        activityAt: d.delivered_at ?? d.updated_at ?? d.registered_at,
      }))
    },
  })

  // Grupper pr. status og anvend tidsvinduet på de afsluttede sektioner.
  const grouped = useMemo(() => {
    const now = Date.now()
    const out: Record<string, BoardParcel[]> = {}
    for (const status of SECTIONS) {
      const all = (data ?? []).filter((p) => p.status === status)
      if (!TERMINAL_STATUSES.includes(status)) {
        out[status] = all
        continue
      }
      const hours = windowFor(status)
      out[status] = hours === 0
        ? all
        : all.filter((p) => now - new Date(p.activityAt).getTime() <= hours * 3600 * 1000)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, windows])

  if (isPending) return <Skeleton className="h-40 w-full" />

  const toggle = (status: string) =>
    setCollapsed(
      collapsed.includes(status) ? collapsed.filter((s) => s !== status) : [...collapsed, status],
    )

  return (
    <div className="flex flex-col gap-4">
      {SECTIONS.map((status) => {
        const items = grouped[status] ?? []
        const isCollapsed = collapsed.includes(status)
        const isTerminal = TERMINAL_STATUSES.includes(status)
        return (
          <section key={status} className="rounded-lg border border-border bg-panel">
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => toggle(status)}
                className="flex flex-1 cursor-pointer items-center gap-2 text-left"
                aria-expanded={!isCollapsed}
              >
                {isCollapsed ? (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: statusColor[status] }}
                />
                <span className="text-[14px] font-medium">{t(statusLabelKey[status])}</span>
                <span className="text-[14px] text-muted-foreground">: {items.length}</span>
              </button>

              {/* Tidsvindue — kun for de afsluttede sektioner. */}
              {isTerminal && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-foreground"
                      aria-label={t('board.windowLabel')}
                      title={`${t('board.windowLabel')}: ${t(windowLabelKey(windowFor(status)))}`}
                    >
                      <Clock className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {WINDOWS.map((h) => (
                      <DropdownMenuItem
                        key={h}
                        className="cursor-pointer"
                        onClick={() => setWindows({ ...windows, [status]: h })}
                      >
                        <Check
                          className={cn('size-4', windowFor(status) === h ? 'opacity-100' : 'opacity-0')}
                        />
                        {t(windowLabelKey(h))}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {!isCollapsed && (
              <div className="border-t border-border p-3">
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('board.empty')}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {items.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setActive(p)}
                        className="flex cursor-pointer flex-col gap-1 rounded-md border border-border bg-background/50 p-3 text-left transition-colors hover:border-foreground/25 hover:bg-accent/50"
                      >
                        <span className="truncate text-[14px] font-medium">
                          {p.receiverName ?? t('board.noReceiver')}
                        </span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {p.barcode ?? '—'}
                        </span>
                        {p.locationName && (
                          <span className="truncate text-[11px] text-muted-foreground">
                            {p.locationName}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}

      {/* Klik på en kasse → samme visitkort som Søg viser. */}
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('board.parcelTitle')}</DialogTitle>
          </DialogHeader>
          {active && <ParcelSummary parcel={active} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

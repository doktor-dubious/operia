import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Focus,
  LayoutGrid,
  List,
  Search,
  Star,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDetailMaximized } from '@/hooks/use-detail-maximized'
import { cn } from '@/lib/utils'

// Datatabel efter gorm.ai's mønster: sortérbare kolonner, søgning øverst til
// højre, paginering (10 rækker pr. side), checkbox-kolonne til venstre med
// dropdown (Vælg alle / Stjernemarkerede), stjernekolonne til højre (klik
// eller højreklik på rækken toggler), valgt-bjælke under tabellen med
// vis-kun-valgte og slet. Sletning kræver checkbox + at man skriver
// "slet"/"delete" i en advarselsmodal.
// Stjerner gemmes pr. tabel i localStorage (flyttes evt. til kontoen senere).

export type ColumnDef<Row> = {
  key: string
  header: string // færdig-oversat tekst
  sortable?: boolean
  sortValue?: (row: Row) => string | number | null
  render?: (row: Row) => React.ReactNode
  className?: string
}

const PAGE_SIZE = 10
const MAX_PAGE_BUTTONS = 10
const DELETE_WORDS = ['slet', 'delete']

type SortState = { key: string; dir: 'asc' | 'desc' } | null

function loadStars(storageKey: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`operia-stars-${storageKey}`) ?? '[]'))
  } catch {
    return new Set()
  }
}

type PersistedState = {
  query: string
  sort: SortState
  page: number
  selected: string[]
  onlySelected: boolean
  view: 'list' | 'grid'
}

// Gittervisning giver kun mening for små tabeller — over denne grænse skjules
// vælgeren helt og tabellen vises altid som liste.
const GRID_MAX_ROWS = 8

function loadTableState(storageKey: string): Partial<PersistedState> {
  try {
    return JSON.parse(localStorage.getItem(`operia-table-${storageKey}`) ?? '{}')
  } catch {
    return {}
  }
}

export function DataTable<Row extends { id: string }>({
  rows,
  columns,
  entityLabel,
  searchText,
  searchPlaceholder,
  storageKey,
  onDelete,
  selectionActions,
  onRowClick,
  activeRowId,
  toolbar,
}: {
  rows: Row[]
  columns: ColumnDef<Row>[]
  entityLabel: string // fx "medarbejdere" — bruges i tællinger og modal
  searchText: (row: Row) => string
  searchPlaceholder?: string
  storageKey: string
  onDelete?: (ids: string[]) => Promise<void>
  selectionActions?: (ctx: { ids: string[]; clear: () => void }) => React.ReactNode
  onRowClick?: (row: Row) => void
  activeRowId?: string | null
  toolbar?: React.ReactNode
}) {
  const { t } = useTranslation()
  // Skjuler sig selv når detaljepanelet er maksimeret, så siderne ikke hver
  // især skal huske at koble maksimering til tabellen.
  const [maximized] = useDetailMaximized()
  const [initial] = useState(() => loadTableState(storageKey))
  const [query, setQuery] = useState(initial.query ?? '')
  const [sort, setSort] = useState<SortState>(initial.sort ?? null)
  const [page, setPage] = useState(initial.page ?? 1)
  const [selected, setSelected] = useState<Set<string>>(new Set(initial.selected ?? []))
  const [stars, setStars] = useState<Set<string>>(() => loadStars(storageKey))
  const [onlySelected, setOnlySelected] = useState(initial.onlySelected ?? false)
  const [view, setView] = useState<'list' | 'grid'>(initial.view ?? 'list')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteAck, setDeleteAck] = useState(false)
  const [deleteWord, setDeleteWord] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    localStorage.setItem(`operia-stars-${storageKey}`, JSON.stringify([...stars]))
  }, [stars, storageKey])

  useEffect(() => {
    const state: PersistedState = { query, sort, page, selected: [...selected], onlySelected, view }
    localStorage.setItem(`operia-table-${storageKey}`, JSON.stringify(state))
  }, [query, sort, page, selected, onlySelected, view, storageKey])

  // Rækker der er forsvundet (slettet/omfiltreret) skal ikke spøge i valget
  useEffect(() => {
    const ids = new Set(rows.map((row) => row.id))
    setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))))
  }, [rows])

  // "Vis kun valgte" giver ingen mening uden et valg. Når valget tømmes (fx den
  // sidste række afmarkeres), slås tilstanden fra igen — ellers filtreres
  // tabellen til nul rækker, og toggle-knappen sidder i valg-bjælken, som er
  // skjult uden et valg, så der ikke er nogen vej tilbage til alle rækker.
  useEffect(() => {
    if (selected.size === 0) setOnlySelected(false)
  }, [selected])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let result = q ? rows.filter((row) => searchText(row).toLowerCase().includes(q)) : rows
    if (onlySelected && selected.size > 0) result = result.filter((row) => selected.has(row.id))
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, onlySelected, selected])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = col.sortValue!(a)
      const vb = col.sortValue!(b)
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'da') * dir
    })
  }, [filtered, sort, columns])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const gridAvailable = rows.length <= GRID_MAX_ROWS
  const effectiveView = gridAvailable && view === 'grid' ? 'grid' : 'list'

  // Sidevindue: højst MAX_PAGE_BUTTONS knapper, centreret om aktuel side
  const pageButtons = useMemo(() => {
    const start = Math.max(
      1,
      Math.min(safePage - Math.floor(MAX_PAGE_BUTTONS / 2), pageCount - MAX_PAGE_BUTTONS + 1),
    )
    const end = Math.min(pageCount, start + MAX_PAGE_BUTTONS - 1)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }, [safePage, pageCount])

  const toggleSort = (key: string) => {
    setSort((prev) =>
      prev?.key === key
        ? prev.dir === 'asc'
          ? { key, dir: 'desc' }
          : null
        : { key, dir: 'asc' },
    )
  }

  const toggleStar = (id: string) => {
    setStars((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((row) => selected.has(row.id))

  const confirmDelete = async () => {
    if (!onDelete) return
    setDeleting(true)
    try {
      await onDelete([...selected])
      toast.success(t('dataTable.deleted', { count: selected.size, entity: entityLabel }))
      setSelected(new Set())
      setOnlySelected(false)
      setDeleteOpen(false)
    } catch (error) {
      console.error('Sletning fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setDeleting(false)
    }
  }

  const deleteConfirmed = deleteAck && DELETE_WORDS.includes(deleteWord.trim().toLowerCase())

  const renderCell = (col: ColumnDef<Row>, row: Row) =>
    col.render
      ? col.render(row)
      : (((row as Record<string, unknown>)[col.key] as React.ReactNode) ?? '—')

  // Bund-bjælkerne deles mellem liste- og gittervisning
  const paginationBar = (
    <div className="flex items-center justify-between px-4 py-2">
      <span className="text-xs text-muted-foreground">
        {t('dataTable.showing', {
          from: sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
          to: Math.min(safePage * PAGE_SIZE, sorted.length),
          total: sorted.length,
          entity: entityLabel,
        })}
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
  )

  const selectionBar = selected.size > 0 && (
    <div className="flex items-center justify-between px-4 py-2">
      <span className="text-xs text-muted-foreground">
        {t('dataTable.selected', {
          count: selected.size,
          total: rows.length,
          entity: entityLabel,
        })}
      </span>
      <div className="flex items-center gap-1">
        {selectionActions?.({ ids: [...selected], clear: () => setSelected(new Set()) })}
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7', onlySelected && 'bg-accent text-foreground')}
          title={t('dataTable.showOnlySelected')}
          aria-label={t('dataTable.showOnlySelected')}
          onClick={() => {
            setOnlySelected((v) => !v)
            setPage(1)
          }}
        >
          <Focus className="size-4" />
        </Button>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            title={t('dataTable.deleteSelected')}
            aria-label={t('dataTable.deleteSelected')}
            onClick={() => {
              setDeleteAck(false)
              setDeleteWord('')
              setDeleteOpen(true)
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <div className={cn('flex flex-col gap-3', maximized && activeRowId && 'hidden')}>
      <div className="flex items-center justify-between gap-3">
        <div>{toolbar}</div>
        <div className="flex items-center gap-2">
          {gridAvailable && (
            <div className="flex items-center gap-0.5 rounded-md border p-0.5">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-6 w-6', effectiveView === 'list' && 'bg-accent text-foreground')}
                title={t('dataTable.viewList')}
                aria-label={t('dataTable.viewList')}
                onClick={() => setView('list')}
              >
                <List className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-6 w-6', effectiveView === 'grid' && 'bg-accent text-foreground')}
                title={t('dataTable.viewGrid')}
                aria-label={t('dataTable.viewGrid')}
                onClick={() => setView('grid')}
              >
                <LayoutGrid className="size-4" />
              </Button>
            </div>
          )}
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder={searchPlaceholder ?? t('dataTable.search')}
              className="pl-8"
            />
          </div>
        </div>
      </div>

      {effectiveView === 'grid' ? (
        <>
          {pageRows.length === 0 ? (
            <div className="rounded-md border bg-panel py-6 text-center text-sm text-muted-foreground">
              {t('dataTable.noRows')}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {pageRows.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    'flex flex-col gap-3 rounded-md border bg-panel p-4',
                    onRowClick && 'cursor-pointer hover:border-muted-foreground/50',
                    activeRowId === row.id && 'border-muted-foreground/70',
                    selected.has(row.id) && 'bg-accent',
                  )}
                  onClick={() => onRowClick?.(row)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    toggleStar(row.id)
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span onClick={(e) => e.stopPropagation()} className="flex items-center">
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleRow(row.id)}
                        aria-label=""
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {columns.length > 0 && renderCell(columns[0], row)}
                    </span>
                    <button
                      type="button"
                      className="cursor-pointer p-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleStar(row.id)
                      }}
                      aria-label="★"
                    >
                      <Star
                        className={cn(
                          'size-4',
                          stars.has(row.id)
                            ? 'fill-status-neutral text-status-neutral'
                            : 'text-muted-foreground/50 hover:text-muted-foreground',
                        )}
                      />
                    </button>
                  </div>
                  {columns.length > 1 && (
                    <dl className="flex flex-col gap-1.5 text-xs">
                      {columns.slice(1).map((col) => (
                        <div key={col.key} className="flex items-baseline justify-between gap-3">
                          <dt className="shrink-0 text-muted-foreground">{col.header}</dt>
                          <dd className="min-w-0 truncate text-right">{renderCell(col, row)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="divide-y rounded-md border bg-panel">
            {paginationBar}
            {selectionBar}
          </div>
        </>
      ) : (
      <div className="overflow-x-auto rounded-md border bg-panel">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                {/* Både checkboksen og pilen åbner menuen — headerklik vælger
                    aldrig direkte; alt/fravalg sker via menupunkterne. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div
                      role="button"
                      tabIndex={0}
                      className="flex w-fit cursor-pointer items-center"
                      aria-label={t('dataTable.selectAll')}
                    >
                      <Checkbox
                        checked={allFilteredSelected}
                        className="pointer-events-none"
                        tabIndex={-1}
                        aria-hidden
                      />
                      <span className="p-0.5">
                        <ChevronDown className="size-3 text-muted-foreground" />
                      </span>
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    <DropdownMenuItem
                      className="cursor-pointer text-xs"
                      onClick={() => setSelected(new Set(filtered.map((r) => r.id)))}
                    >
                      {t('dataTable.selectAll')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer text-xs"
                      onClick={() =>
                        setSelected(
                          new Set(filtered.filter((r) => stars.has(r.id)).map((r) => r.id)),
                        )
                      }
                    >
                      {t('dataTable.selectStarred')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer text-xs"
                      disabled={selected.size === 0}
                      onClick={() => setSelected(new Set())}
                    >
                      {t('dataTable.deselectAll')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableHead>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.sortable ? (
                    <button
                      type="button"
                      className="flex cursor-pointer items-center gap-1 font-medium hover:text-foreground"
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.header}
                      {sort?.key === col.key ? (
                        sort.dir === 'asc' ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 text-muted-foreground/60" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
              <TableHead className="w-10 text-right">
                <Star className="ml-auto size-3.5 text-muted-foreground" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 2}
                  className="py-6 text-center text-muted-foreground"
                >
                  {t('dataTable.noRows')}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    'hover:bg-table-row-hover',
                    onRowClick && 'cursor-pointer',
                    activeRowId === row.id && 'bg-accent',
                  )}
                  data-state={selected.has(row.id) ? 'selected' : undefined}
                  onClick={() => onRowClick?.(row)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    toggleStar(row.id)
                  }}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggleRow(row.id)}
                      aria-label=""
                    />
                  </TableCell>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {renderCell(col, row)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="cursor-pointer p-1 align-middle"
                      onClick={() => toggleStar(row.id)}
                      aria-label="★"
                    >
                      <Star
                        className={cn(
                          'size-4',
                          stars.has(row.id)
                            ? 'fill-status-neutral text-status-neutral'
                            : 'text-muted-foreground/50 hover:text-muted-foreground',
                        )}
                      />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="divide-y border-t">
          {paginationBar}
          {selectionBar}
        </div>
      </div>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">
              {t('dataTable.deleteTitle', { count: selected.size, entity: entityLabel })}
            </DialogTitle>
            <DialogDescription>
              {t('dataTable.deleteDescription', { count: selected.size, entity: entityLabel })}
            </DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-destructive/40 p-3 text-sm">
            <Checkbox
              checked={deleteAck}
              onCheckedChange={(checked) => setDeleteAck(checked === true)}
              className="mt-0.5"
            />
            <span>{t('dataTable.deleteAcknowledge', { entity: entityLabel })}</span>
          </label>
          <div className="flex flex-col gap-2">
            <Label htmlFor="delete-word">{t('dataTable.typeToConfirm')}</Label>
            <Input
              id="delete-word"
              value={deleteWord}
              onChange={(e) => setDeleteWord(e.target.value)}
              placeholder={t('dataTable.deleteWord')}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteConfirmed || deleting}
              onClick={confirmDelete}
            >
              {deleting
                ? t('common.loading')
                : t('dataTable.deleteTitle', { count: selected.size, entity: entityLabel })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

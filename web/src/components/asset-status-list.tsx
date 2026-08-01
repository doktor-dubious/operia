import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { statusColor, statusLabelKey, type AssetStatus } from '@/components/asset-status-badge'
import { AssetHistory } from '@/components/asset-history'
import { AssetSummary } from '@/components/asset-summary'
import { useCompanyContext } from '@/hooks/use-company-context'
import { ASSET_LOOKUP_COLUMNS, type AssetHit } from '@/lib/asset-lookup'
import { supabase } from '@/lib/supabase'

// Én statuskategori fra aktivoversigten: alle virksomhedens aktiver i
// tilstanden, med søgning (navn/tag/serienr./stregkode/kategori/placering/
// medarbejder) og en popup med aktivets visitkort + fulde historik.
// Flisegitter og paginering som pakkelisten, men uden tidsvinduer — en
// aktivstatus er en tilstand, ikke et gennemløb.

const nf = new Intl.NumberFormat('da-DK')
const PAGE_SIZE = 48
const MAX_ROWS = 2000

function useStatusRows(companyId: string | null, status: AssetStatus) {
  return useQuery({
    queryKey: ['assets', 'board-list', companyId, status],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select(ASSET_LOOKUP_COLUMNS)
        .eq('company_id', companyId!)
        .eq('status', status)
        .order('name')
        .limit(MAX_ROWS)
      if (error) throw error
      return (data ?? []) as unknown as AssetHit[]
    },
  })
}

function AssetTile({ asset, onClick }: { asset: AssetHit; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 rounded-md border border-border bg-panel p-3 text-left transition-colors hover:border-foreground/25 hover:bg-accent/40"
    >
      <span className="truncate text-[13px] font-medium">{asset.name}</span>
      <span className="truncate font-mono text-xs text-muted-foreground">
        {asset.asset_tag ?? asset.serial_no ?? asset.barcode ?? '—'}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {asset.assigned?.full_name ?? asset.location?.name ?? asset.category?.name ?? ''}
      </span>
    </button>
  )
}

export function AssetStatusList({ status }: { status: AssetStatus }) {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data: rows, isPending, refetch } = useStatusRows(companyId, status)
  const [term, setTerm] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AssetHit | null>(null)

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase()
    if (!q) return rows ?? []
    return (rows ?? []).filter((a) =>
      [
        a.name,
        a.asset_tag,
        a.serial_no,
        a.barcode,
        a.condition,
        a.category?.name,
        a.location?.name,
        a.assigned?.full_name,
      ]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    )
  }, [rows, term])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  // Popup'en viser den friskeste udgave af rækken efter en handling.
  const refreshSelected = async () => {
    const res = await refetch()
    if (selected) {
      const updated = res.data?.find((a) => a.id === selected.id)
      setSelected(updated ?? null)
    }
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
          <Link to="/assets/board">
            <ArrowLeft className="size-4" /> {t('assetBoard.backToOverview')}
          </Link>
        </Button>
        <span className="flex items-center gap-2 text-[14px] font-medium">
          <span
            className="size-2.5 rounded-[2px]"
            style={{ backgroundColor: statusColor[status] }}
          />
          {t(statusLabelKey[status])}
          <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
            {isPending ? '—' : nf.format(filtered.length)}
          </span>
        </span>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          placeholder={t('assetBoard.searchPlaceholder')}
          className="pl-8"
          onChange={(e) => {
            setTerm(e.target.value)
            setPage(0)
          }}
        />
      </div>

      {(rows?.length ?? 0) >= MAX_ROWS && (
        <p className="text-xs text-status-neutral-to-bad">
          {t('assetBoard.capped', { count: MAX_ROWS })}
        </p>
      )}

      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-[13px] text-muted-foreground">
          {t('assetBoard.empty')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((asset) => (
            <AssetTile key={asset.id} asset={asset} onClick={() => setSelected(asset)} />
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 text-[13px]">
          <Button
            size="sm"
            variant="outline"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            {t('dataTable.previous')}
          </Button>
          <span className="tabular-nums text-muted-foreground">
            {safePage + 1} / {pageCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            {t('dataTable.next')}
          </Button>
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">{selected.name}</DialogTitle>
              </DialogHeader>
              <AssetSummary asset={selected} onChanged={refreshSelected} />
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('assetFlow.history')}
                </p>
                <AssetHistory assetId={selected.id} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

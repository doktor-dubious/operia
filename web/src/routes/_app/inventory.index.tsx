import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PackageX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Lagervarer (Lager-produktet) — ejes af importen som aktivregisteret:
// ingen oprettelse/redigering herfra, kun deaktivering og hård sletning for
// platform-admins. Antal under genbestillingspunktet markeres.
export const Route = createFileRoute('/_app/inventory/')({
  component: InventoryPage,
})

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['inventory-items', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_items')
        .select(
          'id, sku, name, quantity, reorder_point, unit, unit_cost, on_order, is_active, category:asset_categories (name), location:asset_locations (name)',
        )
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

const lowStock = (row: Row) => row.reorder_point != null && row.quantity <= row.reorder_point

function ItemDetailPane({
  row,
  onClose,
  onDeactivate,
  onDelete,
}: {
  row: Row
  onClose: () => void
  onDeactivate: () => void
  onDelete?: () => void // kun platform-admins (testdata-oprydning)
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')

  const tabs = [
    { key: 'details', label: t('detail.tabDetails') },
    { key: 'data', label: t('detail.tabData') },
    { key: 'actions', label: t('detail.tabActions') },
  ]

  return (
    <DetailTabs tabs={tabs} active={tab} onChange={setTab} onClose={onClose}>
      {tab === 'details' && (
        <div className="flex flex-col gap-5">
          <Field label="ID">
            <div className="relative">
              <Input value={row.id} disabled className="pr-10 font-mono text-xs" />
              <div className="absolute right-1 top-1/2 -translate-y-1/2">
                <CopyButton value={row.id} label={t('detail.copyId')} />
              </div>
            </div>
          </Field>
          <Field label={t('inventoryPage.sku')}>
            <Input value={row.sku ?? ''} disabled className="font-mono" />
          </Field>
          <Field label={t('inventoryPage.name')}>
            <Input value={row.name} disabled />
          </Field>
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            <Field label={t('inventoryPage.category')}>
              <Input value={row.category?.name ?? ''} disabled />
            </Field>
            <Field label={t('inventoryPage.location')}>
              <Input value={row.location?.name ?? ''} disabled />
            </Field>
          </div>
          <Field label={t('inventoryPage.unit')}>
            <Input value={row.unit ?? ''} disabled />
          </Field>
        </div>
      )}
      {tab === 'data' && (
        <div className="flex flex-col gap-5">
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            <Field label={t('inventoryPage.quantity')}>
              <Input value={row.quantity} disabled />
            </Field>
            <Field label={t('inventoryPage.reorderPoint')}>
              <Input value={row.reorder_point ?? ''} disabled />
            </Field>
          </div>
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            <Field label={t('inventoryPage.onOrder')}>
              <Input value={row.on_order} disabled />
            </Field>
            <Field label={t('inventoryPage.unitCost')}>
              <Input value={row.unit_cost ?? ''} disabled />
            </Field>
          </div>
          <Field label={t('inventoryPage.active')}>
            <Input value={row.is_active ? t('common.yes') : t('common.no')} disabled />
          </Field>
        </div>
      )}
      {tab === 'actions' && (
        <div className="flex max-w-2xl flex-col gap-4">
          <div className="flex items-center justify-between rounded-md border p-4">
            <div>
              <p className="text-[13px] font-[450]">{t('inventoryPage.deactivate')}</p>
              <p className="text-xs text-muted-foreground">
                {t('inventoryPage.deactivateDescription')}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={!row.is_active} onClick={onDeactivate}>
              {t('inventoryPage.deactivate')}
            </Button>
          </div>
          {onDelete && (
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('inventoryPage.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('inventoryPage.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={onDelete}>
                {t('inventoryPage.delete')}
              </Button>
            </div>
          )}
        </div>
      )}
    </DetailTabs>
  )
}

function InventoryPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useRows(companyId)
  const { data: access } = useAccess()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['inventory-items'] })

  const deactivate = async (ids: string[], clear: () => void) => {
    const { data: updated, error } = await supabase
      .from('inventory_items')
      .update({ is_active: false })
      .in('id', ids)
      .select('id')
    if (error) {
      console.error('Deaktivering fejlede:', error)
      toast.error(t('common.error'))
      return
    }
    if ((updated?.length ?? 0) !== ids.length) {
      toast.error(t('common.noPermission'))
      return
    }
    toast.success(t('inventoryPage.deactivatedToast', { count: ids.length }))
    clear()
    refresh()
  }

  // Hård sletning kun for platform-admins (oprydning i testdata)
  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('inventory_items')
      .delete()
      .in('id', ids)
      .select('id')
    if (error) throw error
    if ((deleted?.length ?? 0) !== ids.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste (delvist) sletning')
    }
    await refresh()
  }

  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    {
      key: 'sku',
      header: t('inventoryPage.sku'),
      sortable: true,
      sortValue: (r) => r.sku,
      render: (r) => <span className="font-mono text-xs">{r.sku ?? '—'}</span>,
    },
    { key: 'name', header: t('inventoryPage.name'), sortable: true, sortValue: (r) => r.name },
    {
      key: 'category',
      header: t('inventoryPage.category'),
      sortable: true,
      sortValue: (r) => r.category?.name ?? null,
      render: (r) => r.category?.name ?? '—',
    },
    {
      key: 'location',
      header: t('inventoryPage.location'),
      sortable: true,
      sortValue: (r) => r.location?.name ?? null,
      render: (r) => r.location?.name ?? '—',
    },
    {
      key: 'quantity',
      header: t('inventoryPage.quantity'),
      sortable: true,
      sortValue: (r) => r.quantity,
      render: (r) => (
        <span className={cn(lowStock(r) && 'font-medium text-status-neutral-to-bad')}>
          {r.quantity}
          {r.unit ? ` ${r.unit}` : ''}
          {lowStock(r) && ` · ${t('inventoryPage.lowStock')}`}
        </span>
      ),
    },
    {
      key: 'is_active',
      header: t('inventoryPage.active'),
      sortable: true,
      sortValue: (r) => (r.is_active ? 1 : 0),
      render: (r) => (r.is_active ? t('common.yes') : t('common.no')),
    },
  ]

  const activeRow = data?.find((row) => row.id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('nav.inventoryItems').toLowerCase()}
        searchText={(row) =>
          [row.sku, row.name, row.category?.name, row.location?.name].filter(Boolean).join(' ')
        }
        storageKey="inventory-items"
        onRowClick={(row) => setActiveId((prev) => (prev === row.id ? null : row.id))}
        activeRowId={activeId}
        onDelete={access?.isPlatformAdmin ? deleteRows : undefined}
        selectionActions={({ ids, clear }) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t('inventoryPage.deactivate')}
            aria-label={t('inventoryPage.deactivate')}
            onClick={() => deactivate(ids, clear)}
          >
            <PackageX className="size-4" />
          </Button>
        )}
      />
      {activeRow && (
        <ItemDetailPane
          key={activeRow.id}
          row={activeRow}
          onClose={() => setActiveId(null)}
          onDeactivate={() => deactivate([activeRow.id], () => {})}
          onDelete={access?.isPlatformAdmin ? () => setDeleteOpen(true) : undefined}
        />
      )}
      {activeRow && (
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('inventoryPage.deleteTitle', { name: activeRow.name })}
          description={t('inventoryPage.deleteWarning')}
          acknowledgeText={t('inventoryPage.deleteAcknowledge')}
          confirmLabel={t('inventoryPage.delete')}
          onConfirm={async () => {
            await deleteRows([activeRow.id])
            toast.success(t('inventoryPage.deletedToast', { name: activeRow.name }))
            setActiveId(null)
          }}
        />
      )}
    </div>
  )
}

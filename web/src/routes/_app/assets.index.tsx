import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArchiveX } from 'lucide-react'
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

// Aktivregisteret — ejes af importen (som medarbejdere ejes af Flow 0):
// ingen oprettelse/redigering herfra, kun deaktivering (rækken består,
// lånehistorik bevares) og hård sletning for platform-admins (testdata-
// oprydning). Ingen anonymisering — aktiver bærer ingen persondata.
export const Route = createFileRoute('/_app/assets/')({
  component: AssetsPage,
})

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short' })

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['assets', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select(
          'id, asset_tag, name, serial_no, status, condition, purchased_at, purchase_price, warranty_until, is_active, category:asset_categories (name), location:asset_locations (name)',
        )
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function AssetDetailPane({
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
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            <Field label={t('assetsPage.tag')}>
              <Input value={row.asset_tag ?? ''} disabled className="font-mono" />
            </Field>
            <Field label={t('assetsPage.serialNo')}>
              <Input value={row.serial_no ?? ''} disabled className="font-mono" />
            </Field>
          </div>
          <Field label={t('assetsPage.name')}>
            <Input value={row.name} disabled />
          </Field>
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            <Field label={t('assetsPage.category')}>
              <Input value={row.category?.name ?? ''} disabled />
            </Field>
            <Field label={t('assetsPage.location')}>
              <Input value={row.location?.name ?? ''} disabled />
            </Field>
          </div>
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            <Field label={t('assetsPage.status')}>
              <Input value={row.status ?? ''} disabled />
            </Field>
            <Field label={t('assetsPage.condition')}>
              <Input value={row.condition ?? ''} disabled />
            </Field>
          </div>
        </div>
      )}
      {tab === 'data' && (
        <div className="flex flex-col gap-5">
          <Field label={t('assetsPage.purchasedAt')}>
            <Input
              value={row.purchased_at ? dateFormat.format(new Date(row.purchased_at)) : ''}
              disabled
            />
          </Field>
          <Field label={t('assetsPage.purchasePrice')}>
            <Input value={row.purchase_price ?? ''} disabled />
          </Field>
          <Field label={t('assetsPage.warrantyUntil')}>
            <Input
              value={row.warranty_until ? dateFormat.format(new Date(row.warranty_until)) : ''}
              disabled
            />
          </Field>
          <Field label={t('assetsPage.active')}>
            <Input value={row.is_active ? t('common.yes') : t('common.no')} disabled />
          </Field>
        </div>
      )}
      {tab === 'actions' && (
        <div className="flex max-w-2xl flex-col gap-4">
          <div className="flex items-center justify-between rounded-md border p-4">
            <div>
              <p className="text-[13px] font-[450]">{t('assetsPage.deactivate')}</p>
              <p className="text-xs text-muted-foreground">
                {t('assetsPage.deactivateDescription')}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={!row.is_active} onClick={onDeactivate}>
              {t('assetsPage.deactivate')}
            </Button>
          </div>
          {onDelete && (
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('assetsPage.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('assetsPage.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={onDelete}>
                {t('assetsPage.delete')}
              </Button>
            </div>
          )}
        </div>
      )}
    </DetailTabs>
  )
}

function AssetsPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useRows(companyId)
  const { data: access } = useAccess()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['assets'] })

  const deactivate = async (ids: string[], clear: () => void) => {
    const { data: updated, error } = await supabase
      .from('assets')
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
    toast.success(t('assetsPage.deactivatedToast', { count: ids.length }))
    clear()
    refresh()
  }

  // Hård sletning kun for platform-admins (oprydning i testdata)
  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('assets')
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
      key: 'asset_tag',
      header: t('assetsPage.tag'),
      sortable: true,
      sortValue: (r) => r.asset_tag,
      render: (r) => <span className="font-mono text-xs">{r.asset_tag ?? '—'}</span>,
    },
    { key: 'name', header: t('assetsPage.name'), sortable: true, sortValue: (r) => r.name },
    {
      key: 'category',
      header: t('assetsPage.category'),
      sortable: true,
      sortValue: (r) => r.category?.name ?? null,
      render: (r) => r.category?.name ?? '—',
    },
    {
      key: 'location',
      header: t('assetsPage.location'),
      sortable: true,
      sortValue: (r) => r.location?.name ?? null,
      render: (r) => r.location?.name ?? '—',
    },
    {
      key: 'is_active',
      header: t('assetsPage.active'),
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
        entityLabel={t('nav.assets').toLowerCase()}
        searchText={(row) =>
          [row.asset_tag, row.name, row.serial_no, row.category?.name, row.location?.name]
            .filter(Boolean)
            .join(' ')
        }
        storageKey="assets"
        onRowClick={(row) => setActiveId((prev) => (prev === row.id ? null : row.id))}
        activeRowId={activeId}
        onDelete={access?.isPlatformAdmin ? deleteRows : undefined}
        selectionActions={({ ids, clear }) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t('assetsPage.deactivate')}
            aria-label={t('assetsPage.deactivate')}
            onClick={() => deactivate(ids, clear)}
          >
            <ArchiveX className="size-4" />
          </Button>
        )}
      />
      {activeRow && (
        <AssetDetailPane
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
          title={t('assetsPage.deleteTitle', { name: activeRow.name })}
          description={t('assetsPage.deleteWarning')}
          acknowledgeText={t('assetsPage.deleteAcknowledge')}
          confirmLabel={t('assetsPage.delete')}
          onConfirm={async () => {
            await deleteRows([activeRow.id])
            toast.success(t('assetsPage.deletedToast', { name: activeRow.name }))
            setActiveId(null)
          }}
        />
      )}
    </div>
  )
}

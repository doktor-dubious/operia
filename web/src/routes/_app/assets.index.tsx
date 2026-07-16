import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { ArchiveX, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

// Aktivregisteret — ejes primært af importen (som medarbejdere ejes af Flow 0),
// men managers kan oprette et aktiv manuelt med "+ Ny". Detaljepanelet er
// skrivebeskyttet; ellers kun deaktivering (rækken består, lånehistorik bevares)
// og hård sletning for platform-admins (testdata-oprydning). Ingen anonymisering
// — aktiver bærer ingen persondata.
export const Route = createFileRoute('/_app/assets/')({
  component: AssetsPage,
})

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short' })

const NONE = '__none__'

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]
type Picker = { id: string; name: string }

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

// Aktive kategorier + placeringer til "+ Ny"-dialogens vælgere.
function usePickers(companyId: string | null) {
  return useQuery({
    queryKey: ['asset-pickers', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [categories, locations] = await Promise.all([
        supabase
          .from('asset_categories')
          .select('id, name')
          .eq('company_id', companyId!)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('asset_locations')
          .select('id, name')
          .eq('company_id', companyId!)
          .eq('is_active', true)
          .order('name'),
      ])
      const err = categories.error ?? locations.error
      if (err) throw err
      return { categories: categories.data as Picker[], locations: locations.data as Picker[] }
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

// Optional-vælger (kategori/placering) med et "—"-punkt for "ingen".
function PickerSelect({
  value,
  onChange,
  items,
}: {
  value: string
  onChange: (v: string) => void
  items: Picker[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {items.map((it) => (
          <SelectItem key={it.id} value={it.id}>
            {it.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function NewAssetDialog({
  open,
  onOpenChange,
  companyId,
  categories,
  locations,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  categories: Picker[]
  locations: Picker[]
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [assetTag, setAssetTag] = useState('')
  const [serialNo, setSerialNo] = useState('')
  const [categoryId, setCategoryId] = useState(NONE)
  const [locationId, setLocationId] = useState(NONE)
  const [busy, setBusy] = useState(false)

  const trimmed = name.trim()

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName('')
      setAssetTag('')
      setSerialNo('')
      setCategoryId(NONE)
      setLocationId(NONE)
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId || !trimmed) return
    setBusy(true)
    const { error } = await supabase.from('assets').insert({
      company_id: companyId,
      name: trimmed,
      asset_tag: assetTag.trim() || null,
      serial_no: serialNo.trim() || null,
      category_id: categoryId === NONE ? null : categoryId,
      location_id: locationId === NONE ? null : locationId,
    })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette aktiv:', error)
      // 23505 = unik-constraint på (company_id, asset_tag)
      toast.error(error.code === '23505' ? t('assetsPage.tagTaken') : describeError(error, t))
      return
    }
    toast.success(t('assetsPage.createdToast', { name: trimmed }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assetsPage.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-asset-name" className="text-label">
            {t('assetsPage.name')}
          </Label>
          <Input
            id="new-asset-name"
            value={name}
            autoFocus
            placeholder={t('assetsPage.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-asset-tag" className="text-label">
              {t('assetsPage.tag')}
            </Label>
            <Input
              id="new-asset-tag"
              value={assetTag}
              className="font-mono"
              placeholder={t('assetsPage.tagPlaceholder')}
              onChange={(e) => setAssetTag(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-asset-serial" className="text-label">
              {t('assetsPage.serialNo')}
            </Label>
            <Input
              id="new-asset-serial"
              value={serialNo}
              className="font-mono"
              onChange={(e) => setSerialNo(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('assetsPage.category')}</Label>
          <PickerSelect value={categoryId} onChange={setCategoryId} items={categories} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('assetsPage.location')}</Label>
          <PickerSelect value={locationId} onChange={setLocationId} items={locations} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !trimmed || !companyId} onClick={create}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AssetsPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useRows(companyId)
  const { data: pickers } = usePickers(companyId)
  const { data: access } = useAccess()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['assets'] })

  const deactivate = async (ids: string[], clear: () => void) => {
    const { data: updated, error } = await supabase
      .from('assets')
      .update({ is_active: false })
      .in('id', ids)
      .select('id')
    if (error) {
      console.error('Deaktivering fejlede:', error)
      toast.error(describeError(error, t))
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
        toolbar={
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> {t('common.new')}
          </Button>
        }
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
      <NewAssetDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        categories={pickers?.categories ?? []}
        locations={pickers?.locations ?? []}
        onCreated={refresh}
      />
    </div>
  )
}

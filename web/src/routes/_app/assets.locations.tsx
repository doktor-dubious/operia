import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

// Aktiv-placeringer: app-ejet stamdata — managers CRUD'er frit. Typen er
// site/rum/hylde/køretøj/reparation (fra prototypen). Sletning nulstiller
// blot placeringsfeltet på eksisterende aktiver (on delete set null).
export const Route = createFileRoute('/_app/assets/locations')({
  component: LocationsPage,
})

// Placeringstyper fra prototypen.
const KINDS = ['site', 'room', 'bin', 'vehicle', 'repair'] as const
type Kind = (typeof KINDS)[number]

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['asset-locations', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_locations')
        .select('id, name, kind, is_active')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function KindSelect({ value, onChange }: { value: Kind; onChange: (v: Kind) => void }) {
  const { t } = useTranslation()
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Kind)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {KINDS.map((kind) => (
          <SelectItem key={kind} value={kind}>
            {t(`assetLocationsPage.kind_${kind}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function LocationDetailPane({
  row,
  onClose,
  onDirtyChange,
  onDeleted,
  refresh,
}: {
  row: Row
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onDeleted: () => void
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')
  const [name, setName] = useState(row.name)
  const [kind, setKind] = useState<Kind>(row.kind as Kind)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const dirty = name !== row.name || kind !== row.kind

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    const { data, error } = await supabase
      .from('asset_locations')
      .update({ name: name.trim(), kind })
      .eq('id', row.id)
      .select('id')
    setSaving(false)
    if (error || !data?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const cancel = () => {
    setName(row.name)
    setKind(row.kind as Kind)
  }

  const setActive = async (is_active: boolean) => {
    const { data, error } = await supabase
      .from('asset_locations')
      .update({ is_active })
      .eq('id', row.id)
      .select('id')
    if (error || !data?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const remove = async () => {
    const { data, error } = await supabase
      .from('asset_locations')
      .delete()
      .eq('id', row.id)
      .select('id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste sletning')
    }
    toast.success(t('assetLocationsPage.deletedToast', { name: row.name }))
    onDeleted()
    refresh()
  }

  const tabs = [
    { key: 'details', label: t('detail.tabDetails') },
    { key: 'actions', label: t('detail.tabActions') },
  ]

  return (
    <>
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
            <Field label={t('assetLocationsPage.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('assetLocationsPage.kindLabel')}>
              <KindSelect value={kind} onChange={setKind} />
            </Field>
          </div>
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">
                  {row.is_active
                    ? t('assetLocationsPage.deactivate')
                    : t('assetLocationsPage.activate')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('assetLocationsPage.deactivateDescription')}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setActive(!row.is_active)}>
                {row.is_active
                  ? t('assetLocationsPage.deactivate')
                  : t('assetLocationsPage.activate')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('assetLocationsPage.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('assetLocationsPage.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('assetLocationsPage.delete')}
              </Button>
            </div>
          </div>
        )}
      </DetailTabs>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !name.trim()}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('assetLocationsPage.deleteTitle', { name: row.name })}
        description={t('assetLocationsPage.deleteWarning')}
        acknowledgeText={t('assetLocationsPage.deleteAcknowledge')}
        confirmLabel={t('assetLocationsPage.delete')}
        onConfirm={remove}
      />
    </>
  )
}

function NewLocationDialog({
  open,
  onOpenChange,
  companyId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('site')
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName('')
      setKind('site')
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId || !name.trim()) return
    setBusy(true)
    const { error } = await supabase.from('asset_locations').insert({
      company_id: companyId,
      name: name.trim(),
      kind,
    })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette placering:', error)
      toast.error(t('common.error'))
      return
    }
    toast.success(t('assetLocationsPage.createdToast', { name: name.trim() }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assetLocationsPage.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-loc-name" className="text-label">
            {t('assetLocationsPage.name')}
          </Label>
          <Input
            id="new-loc-name"
            value={name}
            autoFocus
            placeholder={t('assetLocationsPage.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('assetLocationsPage.kindLabel')}</Label>
          <KindSelect value={kind} onChange={setKind} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !name.trim() || !companyId} onClick={create}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LocationsPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useRows(companyId)
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [paneDirty, setPaneDirty] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['asset-locations'] })

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('asset_locations')
      .delete()
      .in('id', ids)
      .select('id')
    if (error) throw error
    if ((deleted?.length ?? 0) !== ids.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste (delvist) sletning')
    }
    if (activeId && ids.includes(activeId)) setActiveId(null)
    await refresh()
  }

  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    { key: 'name', header: t('assetLocationsPage.name'), sortable: true, sortValue: (r) => r.name },
    {
      key: 'kind',
      header: t('assetLocationsPage.kindLabel'),
      sortable: true,
      sortValue: (r) => r.kind,
      render: (r) => t(`assetLocationsPage.kind_${r.kind}`),
    },
    {
      key: 'is_active',
      header: t('assetLocationsPage.active'),
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
        entityLabel={t('nav.assetLocations').toLowerCase()}
        searchText={(row) => row.name}
        storageKey="asset-locations"
        toolbar={
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> {t('common.new')}
          </Button>
        }
        onDelete={deleteRows}
        onRowClick={(row) => guarded(() => setActiveId(row.id === activeId ? null : row.id))}
        activeRowId={activeId}
      />
      {activeRow && (
        <LocationDetailPane
          key={activeRow.id}
          row={activeRow}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onDeleted={() => setActiveId(null)}
          refresh={refresh}
        />
      )}
      <NewLocationDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        onCreated={refresh}
      />
      <Dialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('unsaved.title')}</DialogTitle>
            <DialogDescription>{t('unsaved.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                pendingAction?.()
                setPendingAction(null)
              }}
            >
              {t('unsaved.discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

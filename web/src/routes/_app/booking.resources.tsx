import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
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

// Booking-ressourcer: det der kan bookes (lokaler, biler, udstyr). App-ejet
// stamdata — booking_managers CRUD'er frit. Tidsgranulariteten kan overstyres
// pr. ressource; standard er virksomhedens indstilling (Konfigurér → Booking).
// Sletning er kun mulig uden bookinger (FK restrict) —
// ellers deaktiveres ressourcen.
export const Route = createFileRoute('/_app/booking/resources')({
  component: ResourcesPage,
})

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

type ResourceValue = {
  name: string
  category_id: string | null
  location: string
  capacity: string
  time_mode: 'inherit' | 'timed' | 'day'
  description: string
}

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['booking-resources', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_resources')
        .select('id, name, category_id, location, capacity, time_mode, description, is_active, category:booking_categories (name)')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

// Egen nøgle, ikke kategorisidens ['booking-categories', companyId]: de to
// forespørgsler henter FORSKELLIGE kolonner, og deler de nøgle, serverer
// TanStack Query den ene sides rækker til den anden — kategorisiden ville så
// læse color_index som undefined og gemme farven væk igen.
function useCategories(companyId: string | null) {
  return useQuery({
    queryKey: ['booking-categories', 'options', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_categories')
        .select('id, name, is_active')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })
}

function toValue(row: Row): ResourceValue {
  return {
    name: row.name,
    category_id: row.category_id,
    location: row.location ?? '',
    capacity: row.capacity == null ? '' : String(row.capacity),
    time_mode: row.time_mode === 'timed' || row.time_mode === 'day' ? row.time_mode : 'inherit',
    description: row.description ?? '',
  }
}

function toPatch(v: ResourceValue) {
  return {
    name: v.name.trim(),
    category_id: v.category_id,
    location: v.location.trim() || null,
    capacity: v.capacity.trim() === '' ? null : Number(v.capacity),
    time_mode: v.time_mode === 'inherit' ? null : v.time_mode,
    description: v.description.trim() || null,
  }
}

function valueKey(v: ResourceValue): string {
  return JSON.stringify(toPatch(v))
}

function valueError(v: ResourceValue): string | null {
  if (!v.name.trim()) return 'nameRequired'
  if (v.capacity.trim() !== '' && (!/^\d+$/.test(v.capacity.trim()) || Number(v.capacity) < 1))
    return 'capacityInvalid'
  return null
}

function ResourceFields({
  value,
  onChange,
  categories,
  idPrefix,
}: {
  value: ResourceValue
  onChange: (v: ResourceValue) => void
  categories: { id: string; name: string; is_active: boolean }[]
  idPrefix: string
}) {
  const { t } = useTranslation()
  const set = (patch: Partial<ResourceValue>) => onChange({ ...value, ...patch })
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-name`} className="text-label">
          {t('bookingResourcesPage.name')}
        </Label>
        <Input
          id={`${idPrefix}-name`}
          value={value.name}
          placeholder={t('bookingResourcesPage.namePlaceholder')}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label className="text-label">{t('bookingResourcesPage.category')}</Label>
        <Select
          value={value.category_id ?? 'none'}
          onValueChange={(v) => set({ category_id: v === 'none' ? null : v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('bookingResourcesPage.noCategory')}</SelectItem>
            {categories
              .filter((c) => c.is_active || c.id === value.category_id)
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-location`} className="text-label">
          {t('bookingResourcesPage.location')}
        </Label>
        <Input
          id={`${idPrefix}-location`}
          value={value.location}
          placeholder={t('bookingResourcesPage.locationPlaceholder')}
          onChange={(e) => set({ location: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-capacity`} className="text-label">
          {t('bookingResourcesPage.capacity')}
        </Label>
        <Input
          id={`${idPrefix}-capacity`}
          value={value.capacity}
          inputMode="numeric"
          placeholder={t('bookingResourcesPage.capacityPlaceholder')}
          onChange={(e) => set({ capacity: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label className="text-label">{t('bookingResourcesPage.timeMode')}</Label>
        <Select
          value={value.time_mode}
          onValueChange={(v) => set({ time_mode: v as ResourceValue['time_mode'] })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">{t('bookingResourcesPage.timeModeInherit')}</SelectItem>
            <SelectItem value="timed">{t('bookingConfig.modeTimed')}</SelectItem>
            <SelectItem value="day">{t('bookingConfig.modeDay')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-description`} className="text-label">
          {t('bookingResourcesPage.description')}
        </Label>
        <Input
          id={`${idPrefix}-description`}
          value={value.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>
    </>
  )
}

function ResourceDetailPane({
  row,
  categories,
  onClose,
  onDirtyChange,
  onDeleted,
  refresh,
}: {
  row: Row
  categories: { id: string; name: string; is_active: boolean }[]
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onDeleted: () => void
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')
  const [value, setValue] = useState<ResourceValue>(toValue(row))
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const dirty = valueKey(value) !== valueKey(toValue(row))

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const save = async () => {
    const invalid = valueError(value)
    if (invalid) {
      toast.error(t(`bookingResourcesPage.${invalid}`))
      return
    }
    setSaving(true)
    const { data, error } = await supabase
      .from('booking_resources')
      .update(toPatch(value))
      .eq('id', row.id)
      .select('id')
    setSaving(false)
    if (error || !data?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const setActive = async (is_active: boolean) => {
    const { data, error } = await supabase
      .from('booking_resources')
      .update({ is_active })
      .eq('id', row.id)
      .select('id')
    if (error || !data?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const remove = async () => {
    const { data, error } = await supabase
      .from('booking_resources')
      .delete()
      .eq('id', row.id)
      .select('id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste sletning')
    }
    toast.success(t('bookingResourcesPage.deletedToast', { name: row.name }))
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
          <div className="flex max-w-2xl flex-col gap-5">
            <Field label="ID">
              <div className="relative">
                <Input value={row.id} disabled className="pr-10 font-mono text-xs" />
                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                  <CopyButton value={row.id} label={t('detail.copyId')} />
                </div>
              </div>
            </Field>
            <ResourceFields
              value={value}
              onChange={setValue}
              categories={categories}
              idPrefix={`res-${row.id}`}
            />
          </div>
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">
                  {row.is_active
                    ? t('bookingResourcesPage.deactivate')
                    : t('bookingResourcesPage.activate')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('bookingResourcesPage.deactivateDescription')}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setActive(!row.is_active)}>
                {row.is_active
                  ? t('bookingResourcesPage.deactivate')
                  : t('bookingResourcesPage.activate')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('bookingResourcesPage.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('bookingResourcesPage.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('bookingResourcesPage.delete')}
              </Button>
            </div>
          </div>
        )}
      </DetailTabs>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => setValue(toValue(row))} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !value.name.trim()}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('bookingResourcesPage.deleteTitle', { name: row.name })}
        description={t('bookingResourcesPage.deleteWarning')}
        acknowledgeText={t('bookingResourcesPage.deleteAcknowledge')}
        confirmLabel={t('bookingResourcesPage.delete')}
        onConfirm={remove}
      />
    </>
  )
}

const EMPTY_VALUE: ResourceValue = {
  name: '',
  category_id: null,
  location: '',
  capacity: '',
  time_mode: 'inherit',
  description: '',
}

function NewResourceDialog({
  open,
  onOpenChange,
  companyId,
  categories,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  categories: { id: string; name: string; is_active: boolean }[]
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState<ResourceValue>(EMPTY_VALUE)
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) setValue(EMPTY_VALUE)
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId) return
    const invalid = valueError(value)
    if (invalid) {
      toast.error(t(`bookingResourcesPage.${invalid}`))
      return
    }
    setBusy(true)
    const { error } = await supabase.from('booking_resources').insert({
      company_id: companyId,
      ...toPatch(value),
    })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette ressource:', error)
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('bookingResourcesPage.createdToast', { name: value.name.trim() }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('bookingResourcesPage.newTitle')}</DialogTitle>
        </DialogHeader>
        <ResourceFields value={value} onChange={setValue} categories={categories} idPrefix="new-res" />
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !value.name.trim() || !companyId} onClick={create}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResourcesPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useRows(companyId)
  const { data: categories } = useCategories(companyId)
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [paneDirty, setPaneDirty] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('booking'),
    })

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('booking_resources')
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
    { key: 'name', header: t('bookingResourcesPage.name'), sortable: true, sortValue: (r) => r.name },
    {
      key: 'category',
      header: t('bookingResourcesPage.category'),
      sortable: true,
      sortValue: (r) => r.category?.name ?? '',
      render: (r) => r.category?.name ?? '—',
    },
    {
      key: 'location',
      header: t('bookingResourcesPage.location'),
      sortable: true,
      sortValue: (r) => r.location ?? '',
      render: (r) => r.location ?? '',
    },
    {
      key: 'capacity',
      header: t('bookingResourcesPage.capacity'),
      sortable: true,
      sortValue: (r) => r.capacity ?? 0,
      render: (r) => (r.capacity == null ? '' : String(r.capacity)),
    },
    {
      key: 'is_active',
      header: t('bookingResourcesPage.active'),
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
        entityLabel={t('nav.bookingResources').toLowerCase()}
        searchText={(row) => [row.name, row.location, row.category?.name].filter(Boolean).join(' ')}
        storageKey="booking-resources"
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
        <ResourceDetailPane
          key={activeRow.id}
          row={activeRow}
          categories={categories ?? []}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onDeleted={() => setActiveId(null)}
          refresh={refresh}
        />
      )}
      <NewResourceDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        categories={categories ?? []}
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

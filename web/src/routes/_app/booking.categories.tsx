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
import { Skeleton } from '@/components/ui/skeleton'
import { BookingColorPicker } from '@/components/booking-color-picker'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { useCompanyContext } from '@/hooks/use-company-context'
import { bookingCategoryColors, invalidateBookingQueries } from '@/lib/booking'
import { supabase } from '@/lib/supabase'

// Booking-kategorier: app-ejet stamdata (Mødelokale, Bil, Udstyr …) —
// booking_managers CRUD'er frit. Sletning nulstiller blot kategorifeltet på
// eksisterende ressourcer (on delete set null).
export const Route = createFileRoute('/_app/booking/categories')({
  component: CategoriesPage,
})

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['booking-categories', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_categories')
        .select('id, name, is_active, color_index, vat_code')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function CategoryDetailPane({
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
  const [colorIndex, setColorIndex] = useState<number | null>(row.color_index)
  const [vat, setVat] = useState(row.vat_code ?? '')
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const dirty = name !== row.name || colorIndex !== row.color_index || vat !== (row.vat_code ?? '')

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    const { data, error } = await supabase
      .from('booking_categories')
      .update({ name: name.trim(), color_index: colorIndex, vat_code: vat.trim() || null })
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
      .from('booking_categories')
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
      .from('booking_categories')
      .delete()
      .eq('id', row.id)
      .select('id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste sletning')
    }
    toast.success(t('bookingCategoriesPage.deletedToast', { name: row.name }))
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
            <Field label={t('bookingCategoriesPage.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
              label={t('bookingCategoriesPage.color')}
              info={t('bookingCategoriesPage.colorHint')}
            >
              <BookingColorPicker value={colorIndex} onChange={setColorIndex} />
            </Field>
            {/* Momskoden bor på kategorien (A-06): et lokales momsbehandling
                følger, hvad slags ting det er — ikke prisen eller perioden. */}
            <Field label={t('bookingVat.label')} info={t('bookingVat.categoryHint')}>
              <Input
                value={vat}
                maxLength={16}
                placeholder={t('bookingVat.placeholder')}
                onChange={(e) => setVat(e.target.value)}
              />
            </Field>
          </div>
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">
                  {row.is_active
                    ? t('bookingCategoriesPage.deactivate')
                    : t('bookingCategoriesPage.activate')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('bookingCategoriesPage.deactivateDescription')}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setActive(!row.is_active)}>
                {row.is_active
                  ? t('bookingCategoriesPage.deactivate')
                  : t('bookingCategoriesPage.activate')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('bookingCategoriesPage.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('bookingCategoriesPage.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('bookingCategoriesPage.delete')}
              </Button>
            </div>
          </div>
        )}
      </DetailTabs>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => {
              setName(row.name)
              setColorIndex(row.color_index)
              setVat(row.vat_code ?? '')
            }}
          >
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
        title={t('bookingCategoriesPage.deleteTitle', { name: row.name })}
        description={t('bookingCategoriesPage.deleteWarning')}
        acknowledgeText={t('bookingCategoriesPage.deleteAcknowledge')}
        confirmLabel={t('bookingCategoriesPage.delete')}
        onConfirm={remove}
      />
    </>
  )
}

function NewCategoryDialog({
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
  const [colorIndex, setColorIndex] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName('')
      setColorIndex(null)
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId || !name.trim()) return
    setBusy(true)
    const { error } = await supabase.from('booking_categories').insert({
      company_id: companyId,
      name: name.trim(),
      // null = lad serveren tage den laveste ledige plads i paletten.
      color_index: colorIndex,
    })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette kategori:', error)
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('bookingCategoriesPage.createdToast', { name: name.trim() }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('bookingCategoriesPage.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-booking-cat-name" className="text-label">
            {t('bookingCategoriesPage.name')}
          </Label>
          <Input
            id="new-booking-cat-name"
            value={name}
            autoFocus
            placeholder={t('bookingCategoriesPage.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingCategoriesPage.color')}</Label>
          <BookingColorPicker value={colorIndex} onChange={setColorIndex} allowAuto />
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

function CategoriesPage() {
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

  // Bredt, som de øvrige booking-sider: en farve- eller navneændring skal også
  // slå igennem i kalenderens ['booking-category-colors'] og på ressourcesiden.
  const refresh = () => invalidateBookingQueries(queryClient)

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('booking_categories')
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
    {
      key: 'name',
      header: t('bookingCategoriesPage.name'),
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <span className="flex items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: bookingCategoryColors(r.color_index).background }}
          />
          {r.name}
        </span>
      ),
    },
    {
      key: 'is_active',
      header: t('bookingCategoriesPage.active'),
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
        entityLabel={t('nav.bookingCategories').toLowerCase()}
        searchText={(row) => row.name}
        storageKey="booking-categories"
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
        <CategoryDetailPane
          key={activeRow.id}
          row={activeRow}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onDeleted={() => setActiveId(null)}
          refresh={refresh}
        />
      )}
      <NewCategoryDialog
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

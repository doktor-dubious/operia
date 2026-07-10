import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/locations')({
  component: LocationsPage,
})

// Placeringer med detaljepanel (gorm.ai-mønsteret): klik på en række åbner
// faneblade under tabellen — Detaljer (id/navn/beskrivelse/noter),
// Data (stregkode) og Handlinger (aktivér/deaktivér, slet).

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows() {
  return useQuery({
    queryKey: ['storage-locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('storage_locations')
        .select('id, name, barcode, is_active, description, notes')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <Label className="text-[lab(66.128_-0.0000298023_0.0000119209)]">{label}</Label>
      {children}
    </div>
  )
}

function LocationDetailPane({
  row,
  onClose,
  onDirtyChange,
}: {
  row: Row
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('details')
  const [name, setName] = useState(row.name)
  const [description, setDescription] = useState(row.description ?? '')
  const [notes, setNotes] = useState(row.notes ?? '')
  const [barcode, setBarcode] = useState(row.barcode ?? '')
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteAck, setDeleteAck] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['storage-locations'] })

  const dirty =
    name !== row.name ||
    description !== (row.description ?? '') ||
    notes !== (row.notes ?? '') ||
    barcode !== (row.barcode ?? '')

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const save = async (fields: Partial<Row>) => {
    setSaving(true)
    const { error } = await supabase.from('storage_locations').update(fields).eq('id', row.id)
    setSaving(false)
    if (error) {
      console.error('Kunne ikke gemme placering:', error)
      toast.error(t('common.error'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const saveAll = () =>
    save({
      name: name.trim(),
      description: description.trim() || null,
      notes: notes.trim() || null,
      barcode: barcode.trim() || null,
    })

  const cancel = () => {
    setName(row.name)
    setDescription(row.description ?? '')
    setNotes(row.notes ?? '')
    setBarcode(row.barcode ?? '')
  }

  const toggleActive = async () => {
    await save({ is_active: !row.is_active })
  }

  const remove = async () => {
    const { error } = await supabase.from('storage_locations').delete().eq('id', row.id)
    if (error) {
      console.error('Sletning fejlede:', error)
      toast.error(t('common.error'))
      return
    }
    toast.success(t('locationDetail.deletedToast', { name: row.name }))
    setDeleteOpen(false)
    onClose()
    refresh()
  }

  const tabs = [
    { key: 'details', label: t('locationDetail.tabDetails') },
    { key: 'data', label: t('locationDetail.tabData') },
    { key: 'actions', label: t('locationDetail.tabActions') },
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
                  <CopyButton value={row.id} label={t('locationDetail.copyId')} />
                </div>
              </div>
            </Field>
            <Field label={t('locations.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('locationDetail.description')}>
              <Textarea
                value={description}
                rows={2}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label={t('locationDetail.notes')}>
              <Textarea value={notes} rows={3} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        )}
        {tab === 'data' && (
          <div className="flex flex-col gap-5">
            <Field label={t('locations.barcode')}>
              <Input
                value={barcode}
                className="font-mono"
                placeholder={t('locationDetail.barcodePlaceholder')}
                onChange={(e) => setBarcode(e.target.value)}
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
                    ? t('locationDetail.deactivate')
                    : t('locationDetail.activate')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('locationDetail.deactivateDescription')}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={saving} onClick={toggleActive}>
                {row.is_active ? t('locationDetail.deactivate') : t('locationDetail.activate')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('locationDetail.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('locationDetail.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('locationDetail.delete')}
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
          <Button size="sm" onClick={saveAll} disabled={saving || !name.trim()}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      <Dialog
        open={deleteOpen}
        onOpenChange={(next) => {
          if (!next) setDeleteAck(false)
          setDeleteOpen(next)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">
              {t('locationDetail.deleteTitle', { name: row.name })}
            </DialogTitle>
            <DialogDescription>{t('locationDetail.deleteWarning')}</DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-destructive/40 p-3 text-sm">
            <Checkbox
              checked={deleteAck}
              onCheckedChange={(checked) => setDeleteAck(checked === true)}
              className="mt-0.5"
            />
            <span>{t('locationDetail.deleteAcknowledge')}</span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={!deleteAck} onClick={remove}>
              {t('locationDetail.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function LocationsPage() {
  const { t } = useTranslation()
  const { data, isPending } = useRows()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [paneDirty, setPaneDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  // Skift/luk med ugemte ændringer kræver bekræftelse
  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const deleteRows = async (ids: string[]) => {
    const { error } = await supabase.from('storage_locations').delete().in('id', ids)
    if (error) throw error
    if (activeId && ids.includes(activeId)) setActiveId(null)
    await queryClient.invalidateQueries({ queryKey: ['storage-locations'] })
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    { key: 'name', header: t('locations.name'), sortable: true, sortValue: (r) => r.name },
    {
      key: 'barcode',
      header: t('locations.barcode'),
      sortable: true,
      sortValue: (r) => r.barcode,
      render: (r) => <span className="font-mono text-xs">{r.barcode ?? '—'}</span>,
    },
    {
      key: 'is_active',
      header: t('locations.active'),
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
        entityLabel={t('nav.locations').toLowerCase()}
        searchText={(row) => [row.name, row.barcode].filter(Boolean).join(' ')}
        storageKey="storage-locations"
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
        />
      )}
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

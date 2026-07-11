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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { CopyButton } from '@/components/copy-button'
import { Field } from '@/components/detail-field'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/locations')({
  component: LocationsPage,
})

// Placeringer med detaljepanel (gorm.ai-mønsteret): klik på en række åbner
// faneblade under tabellen — Detaljer (id/navn/beskrivelse/noter),
// Data (stregkode) og Handlinger (aktivér/deaktivér, slet).

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['storage-locations', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('storage_locations')
        .select('id, name, barcode, is_active, description, notes')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
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
    const { data, error } = await supabase
      .from('storage_locations')
      .update(fields)
      .eq('id', row.id)
      .select('id')
    setSaving(false)
    if (error) {
      console.error('Kunne ikke gemme placering:', error)
      toast.error(t('common.error'))
      return false
    }
    if (!data?.length) {
      // RLS afviste skrivningen — 0 rækker uden fejl må aldrig ligne succes
      toast.error(t('common.noPermission'))
      return false
    }
    toast.success(t('settings.saved'))
    refresh()
    return true
  }

  const saveAll = async () => {
    const ok = await save({
      name: name.trim(),
      description: description.trim() || null,
      notes: notes.trim() || null,
      barcode: barcode.trim() || null,
    })
    if (ok) {
      // normalisér lokal state, ellers forbliver panelet "dirty"
      setName(name.trim())
      setDescription(description.trim())
      setNotes(notes.trim())
      setBarcode(barcode.trim())
    }
  }

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
    const { data, error } = await supabase
      .from('storage_locations')
      .delete()
      .eq('id', row.id)
      .select('id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste sletning')
    }
    toast.success(t('locationDetail.deletedToast', { name: row.name }))
    onClose()
    refresh()
  }

  const tabs = [
    { key: 'details', label: t('detail.tabDetails') },
    { key: 'data', label: t('detail.tabData') },
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

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('locationDetail.deleteTitle', { name: row.name })}
        description={t('locationDetail.deleteWarning')}
        acknowledgeText={t('locationDetail.deleteAcknowledge')}
        confirmLabel={t('locationDetail.delete')}
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
  const [barcode, setBarcode] = useState('')
  const [busy, setBusy] = useState(false)

  // Én lukkevej: nulstiller altid felterne
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName('')
      setBarcode('')
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId || !name.trim()) return
    setBusy(true)
    const { error } = await supabase.from('storage_locations').insert({
      company_id: companyId,
      name: name.trim(),
      barcode: barcode.trim() || null,
    })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette placering:', error)
      toast.error(t('common.error'))
      return
    }
    toast.success(t('locationDetail.createdToast', { name: name.trim() }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('locationDetail.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-loc-name" className="text-label">{t('locations.name')}</Label>
          <Input
            id="new-loc-name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-loc-barcode" className="text-label">{t('locations.barcode')}</Label>
          <Input
            id="new-loc-barcode"
            value={barcode}
            className="font-mono"
            placeholder={t('locationDetail.barcodePlaceholder')}
            onChange={(e) => setBarcode(e.target.value)}
          />
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

  // Skift/luk med ugemte ændringer kræver bekræftelse
  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('storage_locations')
      .delete()
      .in('id', ids)
      .select('id')
    if (error) throw error
    if ((deleted?.length ?? 0) !== ids.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste (delvist) sletning')
    }
    if (activeId && ids.includes(activeId)) setActiveId(null)
    await queryClient.invalidateQueries({ queryKey: ['storage-locations'] })
  }

  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

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
        toolbar={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
              <Plus className="size-4" /> {t('common.new')}
            </Button>
          </div>
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
        />
      )}
      <NewLocationDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['storage-locations'] })}
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

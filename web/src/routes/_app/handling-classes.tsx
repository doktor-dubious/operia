import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
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
import { CompanyPicker } from '@/components/company-picker'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/handling-classes')({
  component: HandlingClassesPage,
})

// Håndteringsklasser er app-ejet stamdata (managers redigerer frit):
// redigerbart detaljepanel som placeringer — Detaljer (id/navn/beskrivelse),
// Data (proxy-/efterladelsesregler), Handlinger (slet).

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['handling-classes', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('handling_classes')
        .select('id, name, allow_proxy_collection, allow_leave_at_location, description')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex max-w-2xl cursor-pointer items-center gap-3 rounded-md border p-3 text-[13px]">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      {label}
    </label>
  )
}

function HandlingClassDetailPane({
  row,
  onClose,
  onDirtyChange,
  onDeleted,
}: {
  row: Row
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('details')
  const [name, setName] = useState(row.name)
  const [description, setDescription] = useState(row.description ?? '')
  const [allowProxy, setAllowProxy] = useState(row.allow_proxy_collection)
  const [allowLeave, setAllowLeave] = useState(row.allow_leave_at_location)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['handling-classes'] })

  const dirty =
    name !== row.name ||
    description !== (row.description ?? '') ||
    allowProxy !== row.allow_proxy_collection ||
    allowLeave !== row.allow_leave_at_location

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const saveAll = async () => {
    setSaving(true)
    const { data, error } = await supabase
      .from('handling_classes')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        allow_proxy_collection: allowProxy,
        allow_leave_at_location: allowLeave,
      })
      .eq('id', row.id)
      .select('id')
    setSaving(false)
    if (error) {
      console.error('Kunne ikke gemme håndteringsklasse:', error)
      toast.error(t('common.error'))
      return
    }
    if (!data?.length) {
      // RLS afviste skrivningen — 0 rækker uden fejl må aldrig ligne succes
      toast.error(t('common.noPermission'))
      return
    }
    // normalisér lokal state til det gemte, ellers forbliver panelet "dirty"
    setName(name.trim())
    setDescription(description.trim())
    toast.success(t('settings.saved'))
    refresh()
  }

  const cancel = () => {
    setName(row.name)
    setDescription(row.description ?? '')
    setAllowProxy(row.allow_proxy_collection)
    setAllowLeave(row.allow_leave_at_location)
  }

  const remove = async () => {
    const { data, error } = await supabase
      .from('handling_classes')
      .delete()
      .eq('id', row.id)
      .select('id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste sletning')
    }
    toast.success(t('handlingClassDetail.deletedToast', { name: row.name }))
    onDeleted()
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
            <Field label={t('handlingClasses.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('handlingClasses.description')}>
              <Textarea
                value={description}
                rows={2}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>
        )}
        {tab === 'data' && (
          <div className="flex flex-col gap-3">
            <CheckboxRow
              label={t('handlingClasses.allowProxy')}
              checked={allowProxy}
              onChange={setAllowProxy}
            />
            <CheckboxRow
              label={t('handlingClasses.allowLeave')}
              checked={allowLeave}
              onChange={setAllowLeave}
            />
          </div>
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('handlingClassDetail.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('handlingClassDetail.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('handlingClassDetail.delete')}
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
        title={t('handlingClassDetail.deleteTitle', { name: row.name })}
        description={t('handlingClassDetail.deleteWarning')}
        acknowledgeText={t('handlingClassDetail.deleteAcknowledge')}
        confirmLabel={t('handlingClassDetail.delete')}
        onConfirm={remove}
      />
    </>
  )
}

function NewHandlingClassDialog({
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
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  // Én lukkevej: nulstiller altid felterne
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName('')
      setDescription('')
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId || !name.trim()) return
    setBusy(true)
    const { error } = await supabase.from('handling_classes').insert({
      company_id: companyId,
      name: name.trim(),
      description: description.trim() || null,
    })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette håndteringsklasse:', error)
      toast.error(t('common.error'))
      return
    }
    toast.success(t('handlingClassDetail.createdToast', { name: name.trim() }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('handlingClassDetail.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-hc-name" className="text-label">
            {t('handlingClasses.name')}
          </Label>
          <Input id="new-hc-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-hc-desc" className="text-label">
            {t('handlingClasses.description')}
          </Label>
          <Textarea
            id="new-hc-desc"
            value={description}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
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

function HandlingClassesPage() {
  const { t } = useTranslation()
  const { companyId, companies, setCompanyId } = useCompanyContext()
  const { data, isPending } = useRows(companyId)
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [paneDirty, setPaneDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['handling-classes'] })

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('handling_classes')
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
    { key: 'name', header: t('handlingClasses.name'), sortable: true, sortValue: (r) => r.name },
    { key: 'proxy', header: t('handlingClasses.allowProxy'), sortable: true, sortValue: (r) => (r.allow_proxy_collection ? 1 : 0), render: (r) => (r.allow_proxy_collection ? t('common.yes') : t('common.no')) },
    { key: 'leave', header: t('handlingClasses.allowLeave'), sortable: true, sortValue: (r) => (r.allow_leave_at_location ? 1 : 0), render: (r) => (r.allow_leave_at_location ? t('common.yes') : t('common.no')) },
    { key: 'description', header: t('handlingClasses.description'), render: (r) => <span className="text-muted-foreground">{r.description ?? '—'}</span> },
  ]

  const activeRow = data?.find((row) => row.id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('nav.handlingClasses').toLowerCase()}
        searchText={(row) => [row.name, row.description].filter(Boolean).join(' ')}
        storageKey="handling-classes"
        toolbar={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
              <Plus className="size-4" /> {t('common.new')}
            </Button>
            <CompanyPicker
              companies={companies}
              value={companyId}
              onChange={(id) => {
                setActiveId(null)
                setCompanyId(id)
              }}
            />
          </div>
        }
        onRowClick={(row) => guarded(() => setActiveId(row.id === activeId ? null : row.id))}
        activeRowId={activeId}
        onDelete={deleteRows}
      />
      {activeRow && (
        <HandlingClassDetailPane
          key={activeRow.id}
          row={activeRow}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onDeleted={() => setActiveId(null)}
        />
      )}
      <NewHandlingClassDialog open={newOpen} onOpenChange={setNewOpen} companyId={companyId} onCreated={refresh} />
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

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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { CompanyPicker } from '@/components/company-picker'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/carriers')({
  component: CarriersPage,
})

// Fragtfirmaer (app-ejet stamdata). Bemærkninger fra review:
//  - Alle skrivninger tjekker antal berørte rækker (RLS-afviste opdateringer
//    returnerer 0 rækker uden fejl — det må aldrig ligne succes).
//  - Forespørgslen er altid virksomheds-scopet; platform-admins vælger
//    virksomhed i værktøjslinjen i stedet for at se en blandet liste.
//  - Slet i panelet bruger samme ord-beskyttede dialog som bulk-slet.

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['carriers', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carriers')
        .select('id, name, is_active')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function CarrierDetailPane({
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
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const dirty = name !== row.name

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const save = async (fields: Partial<Row>) => {
    setSaving(true)
    const { data, error } = await supabase
      .from('carriers')
      .update(fields)
      .eq('id', row.id)
      .select('id')
    setSaving(false)
    if (error) {
      console.error('Kunne ikke gemme fragtfirma:', error)
      toast.error(t('common.error'))
      return false
    }
    if (!data?.length) {
      // RLS afviste skrivningen (fx parcel handler uden manager-rolle)
      toast.error(t('common.noPermission'))
      return false
    }
    toast.success(t('settings.saved'))
    refresh()
    return true
  }

  const saveName = async () => {
    const trimmed = name.trim()
    if (await save({ name: trimmed })) setName(trimmed)
  }

  const remove = async () => {
    const { data, error } = await supabase
      .from('carriers')
      .delete()
      .eq('id', row.id)
      .select('id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste sletning')
    }
    toast.success(t('carrierDetail.deletedToast', { name: row.name }))
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
            <Field label={t('carriersPage.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">
                  {row.is_active ? t('carrierDetail.deactivate') : t('carrierDetail.activate')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('carrierDetail.deactivateDescription')}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => save({ is_active: !row.is_active })}
              >
                {row.is_active ? t('carrierDetail.deactivate') : t('carrierDetail.activate')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('carrierDetail.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('carrierDetail.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('carrierDetail.delete')}
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
            onClick={() => setName(row.name)}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={saveName} disabled={saving || !name.trim()}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('carrierDetail.deleteTitle', { name: row.name })}
        description={t('carrierDetail.deleteWarning')}
        acknowledgeText={t('carrierDetail.deleteAcknowledge')}
        confirmLabel={t('carrierDetail.delete')}
        onConfirm={remove}
      />
    </>
  )
}

function NewCarrierDialog({
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
  const [busy, setBusy] = useState(false)

  // Én lukkevej: nulstiller altid feltet (review-fund: genåbning viste
  // forrige navn, fordi create/annullér gik uden om nulstillingen).
  const handleOpenChange = (next: boolean) => {
    if (!next) setName('')
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId || !name.trim()) return
    setBusy(true)
    const { error } = await supabase
      .from('carriers')
      .insert({ company_id: companyId, name: name.trim() })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette fragtfirma:', error)
      toast.error(t('common.error'))
      return
    }
    toast.success(t('carrierDetail.createdToast', { name: name.trim() }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('carrierDetail.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-carrier-name" className="text-label">
            {t('carriersPage.name')}
          </Label>
          <Input
            id="new-carrier-name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
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

function CarriersPage() {
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

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['carriers'] })

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('carriers')
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
    { key: 'name', header: t('carriersPage.name'), sortable: true, sortValue: (r) => r.name },
    { key: 'is_active', header: t('carriersPage.active'), sortable: true, sortValue: (r) => (r.is_active ? 1 : 0), render: (r) => (r.is_active ? t('common.yes') : t('common.no')) },
  ]

  const activeRow = data?.find((row) => row.id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('nav.carriers').toLowerCase()}
        searchText={(row) => row.name}
        storageKey="carriers"
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
        <CarrierDetailPane
          key={activeRow.id}
          row={activeRow}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onDeleted={() => setActiveId(null)}
          refresh={refresh}
        />
      )}
      <NewCarrierDialog
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

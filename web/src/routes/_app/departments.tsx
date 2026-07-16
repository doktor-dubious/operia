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
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/departments')({
  component: DepartmentsPage,
})

// Afdelinger ejes primært af Flow 0-importen (HR-systemet er kilden), men
// managers kan oprette og redigere dem i appen — samme mønster som skabe/
// fragtfirmaer. Importen upserter på navn, så en manuelt rettet afdeling kan
// blive berørt af næste import; sletning er fortsat forbeholdt platform-admins.

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'medium' })

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['departments-list', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name, created_at, employees (count)')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function DepartmentDetailPane({
  row,
  existingNames,
  onClose,
  onDirtyChange,
  onDelete,
  refresh,
}: {
  row: Row
  existingNames: string[]
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onDelete?: () => void // kun platform-admins
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')
  const [name, setName] = useState(row.name)
  const [saving, setSaving] = useState(false)

  const dirty = name !== row.name

  const trimmed = name.trim()
  const duplicate =
    trimmed !== '' &&
    existingNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase())

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const save = async () => {
    if (!trimmed || duplicate) return
    setSaving(true)
    const { data, error } = await supabase
      .from('departments')
      .update({ name: trimmed })
      .eq('id', row.id)
      .select('id')
    setSaving(false)
    if (error) {
      console.error('Kunne ikke gemme afdeling:', error)
      toast.error(error.code === '23505' ? t('common.nameTaken') : describeError(error, t))
      return
    }
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    setName(trimmed)
    refresh()
  }

  const cancel = () => setName(row.name)

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
            <Field label={t('departments.name')}>
              <Input value={name} aria-invalid={duplicate} onChange={(e) => setName(e.target.value)} />
              {duplicate && (
                <p className="mt-1.5 text-xs text-destructive">{t('common.nameTaken')}</p>
              )}
            </Field>
          </div>
        )}
        {tab === 'data' && (
          <div className="flex flex-col gap-5">
            <Field label={t('departments.employeeCount')}>
              <Input value={String(row.employees?.[0]?.count ?? 0)} disabled />
            </Field>
            <Field label={t('departmentDetail.created')}>
              <Input value={dateFormat.format(new Date(row.created_at))} disabled />
            </Field>
          </div>
        )}
        {tab === 'actions' &&
          (onDelete ? (
            <div className="flex max-w-2xl flex-col gap-4">
              <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
                <div>
                  <p className="text-[13px] font-[450] text-destructive">
                    {t('departmentDetail.delete')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('departmentDetail.deleteDescription')}
                  </p>
                </div>
                <Button size="sm" variant="destructive" onClick={onDelete}>
                  {t('departmentDetail.delete')}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('departmentDetail.noActions')}</p>
          ))}
      </DetailTabs>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !trimmed || duplicate}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </>
  )
}

function NewDepartmentDialog({
  open,
  onOpenChange,
  companyId,
  existingNames,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  existingNames: string[]
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const trimmed = name.trim()
  const duplicate =
    trimmed !== '' &&
    existingNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase())

  const handleOpenChange = (next: boolean) => {
    if (!next) setName('')
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId || !trimmed || duplicate) return
    setBusy(true)
    const { error } = await supabase
      .from('departments')
      .insert({ company_id: companyId, name: trimmed })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette afdeling:', error)
      toast.error(error.code === '23505' ? t('common.nameTaken') : describeError(error, t))
      return
    }
    toast.success(t('departmentDetail.createdToast', { name: trimmed }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('departmentDetail.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-department-name" className="text-label">
            {t('departments.name')}
          </Label>
          <Input
            id="new-department-name"
            value={name}
            autoFocus
            aria-invalid={duplicate}
            onChange={(e) => setName(e.target.value)}
          />
          {duplicate && <p className="text-xs text-destructive">{t('common.nameTaken')}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !trimmed || duplicate || !companyId} onClick={create}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DepartmentsPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useRows(companyId)
  const { data: access } = useAccess()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [paneDirty, setPaneDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['departments-list'] })

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('departments')
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
    { key: 'name', header: t('departments.name'), sortable: true, sortValue: (r) => r.name },
    {
      key: 'count',
      header: t('departments.employeeCount'),
      sortable: true,
      sortValue: (r) => r.employees?.[0]?.count ?? 0,
      render: (r) => r.employees?.[0]?.count ?? 0,
    },
  ]

  const activeRow = data?.find((row) => row.id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('nav.departments').toLowerCase()}
        searchText={(row) => row.name}
        storageKey="departments-list"
        toolbar={
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> {t('common.new')}
          </Button>
        }
        onRowClick={(row) => guarded(() => setActiveId((prev) => (prev === row.id ? null : row.id)))}
        activeRowId={activeId}
        onDelete={access?.isPlatformAdmin ? deleteRows : undefined}
      />
      {activeRow && (
        <DepartmentDetailPane
          key={activeRow.id}
          row={activeRow}
          existingNames={(data ?? []).filter((r) => r.id !== activeRow.id).map((r) => r.name)}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onDelete={access?.isPlatformAdmin ? () => setDeleteOpen(true) : undefined}
          refresh={refresh}
        />
      )}
      {activeRow && (
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('departmentDetail.deleteTitle', { name: activeRow.name })}
          description={t('departmentDetail.deleteWarning')}
          acknowledgeText={t('departmentDetail.deleteAcknowledge')}
          confirmLabel={t('departmentDetail.delete')}
          onConfirm={async () => {
            await deleteRows([activeRow.id])
            toast.success(t('departmentDetail.deletedToast', { name: activeRow.name }))
          }}
        />
      )}
      <NewDepartmentDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        existingNames={(data ?? []).map((row) => row.name)}
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

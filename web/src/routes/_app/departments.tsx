import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

// Afdelinger ejes — som medarbejdere — af Flow 0-importen: felterne er
// read-only, og sletning er forbeholdt platform-admins (testdata-oprydning).

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
  onClose,
  onDelete,
}: {
  row: Row
  onClose: () => void
  onDelete?: () => void // kun platform-admins
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
          <Field label={t('departments.name')}>
            <Input value={row.name} disabled />
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
        onRowClick={(row) => setActiveId((prev) => (prev === row.id ? null : row.id))}
        activeRowId={activeId}
        onDelete={access?.isPlatformAdmin ? deleteRows : undefined}
      />
      {activeRow && (
        <DepartmentDetailPane
          key={activeRow.id}
          row={activeRow}
          onClose={() => setActiveId(null)}
          onDelete={access?.isPlatformAdmin ? () => setDeleteOpen(true) : undefined}
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
    </div>
  )
}

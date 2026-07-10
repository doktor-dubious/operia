import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { UserX, VenetianMask } from 'lucide-react'
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
import { DataTable, type ColumnDef } from '@/components/data-table'
import { useAccess } from '@/hooks/use-access'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/employees')({
  component: EmployeesPage,
})

// Medarbejderkartoteket ejes af Flow 0-importen (HR-systemet er kilden):
// derfor er sletning IKKE standardhandlingen her. I stedet:
//  - Deaktivér: medarbejderen modtager ikke længere pakker; rækken består.
//  - Anonymisér (GDPR): persondata blankes permanent, rækken består så
//    historik/chain-of-custody forbliver intakt.
// Hård sletning er forbeholdt platform-admins (oprydning i testdata).

const ANONYMIZE_WORDS = ['anonymiser', 'anonymize']

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows() {
  return useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, full_name, initials, email, is_active, department:departments (name)')
        .order('full_name')
      if (error) throw error
      return data
    },
  })
}

function AnonymizeDialog({
  ids,
  open,
  onOpenChange,
  onDone,
}: {
  ids: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [ack, setAck] = useState(false)
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)

  const confirmed = ack && ANONYMIZE_WORDS.includes(word.trim().toLowerCase())

  const run = async () => {
    setBusy(true)
    try {
      const { error } = await supabase
        .from('employees')
        .update({
          full_name: t('employeesActions.anonymizedName'),
          initials: null,
          email: null,
          phone: null,
          employee_no: null,
          is_active: false,
        })
        .in('id', ids)
      if (error) throw error
      toast.success(t('employeesActions.anonymizedToast', { count: ids.length }))
      onDone()
      onOpenChange(false)
    } catch (error) {
      console.error('Anonymisering fejlede:', error)
      toast.error(t('common.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setAck(false)
          setWord('')
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">
            {t('employeesActions.anonymizeTitle', { count: ids.length })}
          </DialogTitle>
          <DialogDescription>
            {t('employeesActions.anonymizeDescription', { count: ids.length })}
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-destructive/40 p-3 text-sm">
          <Checkbox
            checked={ack}
            onCheckedChange={(checked) => setAck(checked === true)}
            className="mt-0.5"
          />
          <span>{t('employeesActions.anonymizeAcknowledge')}</span>
        </label>
        <div className="flex flex-col gap-2">
          <Label htmlFor="anonymize-word">{t('employeesActions.typeToConfirm')}</Label>
          <Input
            id="anonymize-word"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder={t('employeesActions.anonymizeWord')}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={!confirmed || busy} onClick={run}>
            {busy
              ? t('common.loading')
              : t('employeesActions.anonymizeTitle', { count: ids.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EmployeesPage() {
  const { t } = useTranslation()
  const { data, isPending } = useRows()
  const { data: access } = useAccess()
  const queryClient = useQueryClient()
  const [anonymizeIds, setAnonymizeIds] = useState<string[]>([])
  const [anonymizeOpen, setAnonymizeOpen] = useState(false)
  const [clearSelection, setClearSelection] = useState<(() => void) | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['employees'] })

  const deactivate = async (ids: string[], clear: () => void) => {
    const { error } = await supabase.from('employees').update({ is_active: false }).in('id', ids)
    if (error) {
      console.error('Deaktivering fejlede:', error)
      toast.error(t('common.error'))
      return
    }
    toast.success(t('employeesActions.deactivatedToast', { count: ids.length }))
    clear()
    refresh()
  }

  // Hård sletning kun for platform-admins (oprydning i testdata)
  const deleteRows = async (ids: string[]) => {
    const { error } = await supabase.from('employees').delete().in('id', ids)
    if (error) throw error
    await refresh()
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    { key: 'full_name', header: t('employees.name'), sortable: true, sortValue: (r) => r.full_name },
    { key: 'initials', header: t('employees.initials'), sortable: true, sortValue: (r) => r.initials, render: (r) => r.initials ?? '—' },
    { key: 'department', header: t('employees.department'), sortable: true, sortValue: (r) => r.department?.name ?? null, render: (r) => r.department?.name ?? '—' },
    { key: 'email', header: t('employees.email'), sortable: true, sortValue: (r) => r.email, render: (r) => r.email ?? '—' },
    { key: 'is_active', header: t('employees.active'), sortable: true, sortValue: (r) => (r.is_active ? 1 : 0), render: (r) => (r.is_active ? t('common.yes') : t('common.no')) },
  ]

  return (
    <>
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('nav.employees').toLowerCase()}
        searchText={(row) =>
          [row.full_name, row.initials, row.email, row.department?.name]
            .filter(Boolean)
            .join(' ')
        }
        storageKey="employees"
        onDelete={access?.isPlatformAdmin ? deleteRows : undefined}
        selectionActions={({ ids, clear }) => (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={t('employeesActions.deactivate')}
              aria-label={t('employeesActions.deactivate')}
              onClick={() => deactivate(ids, clear)}
            >
              <UserX className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title={t('employeesActions.anonymize')}
              aria-label={t('employeesActions.anonymize')}
              onClick={() => {
                setAnonymizeIds(ids)
                setClearSelection(() => clear)
                setAnonymizeOpen(true)
              }}
            >
              <VenetianMask className="size-4" />
            </Button>
          </>
        )}
      />
      <AnonymizeDialog
        ids={anonymizeIds}
        open={anonymizeOpen}
        onOpenChange={setAnonymizeOpen}
        onDone={() => {
          clearSelection?.()
          refresh()
        }}
      />
    </>
  )
}

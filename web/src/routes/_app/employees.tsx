import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Plus, UserX, VenetianMask } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { CopyButton } from '@/components/copy-button'
import { Field } from '@/components/detail-field'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { LANG_OPTIONS } from '@/lib/languages'
import type { Database } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/employees')({
  component: EmployeesPage,
})

// Medarbejderkartoteket ejes primært af Flow 0-importen (HR-systemet er
// kilden), men managers kan oprette og redigere medarbejdere i appen:
//  - "+ Ny" opretter en manuel medarbejder (is_manual=true), som importen
//    aldrig rører.
//  - Felterne kan redigeres. For importerede rækker (is_manual=false) kan
//    ændringer blive overskrevet ved næste import — det oplyses i panelet.
// Sletning er IKKE standardhandlingen; brug Deaktivér / Anonymisér (GDPR).
// Hård sletning er forbeholdt platform-admins (oprydning i testdata).

const ANONYMIZE_WORDS = ['anonymiser', 'anonymize']
const NONE = '__none__'

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]
type Department = { id: string; name: string }

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['employees', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select(
          'id, full_name, first_name, last_name, initials, email, phone, employee_no, nfc_card_id, role, language, is_active, is_manual, department_id, department:departments (name)',
        )
        .eq('company_id', companyId!)
        .order('full_name')
      if (error) throw error
      return data
    },
  })
}

function useDepartments(companyId: string | null) {
  return useQuery({
    queryKey: ['departments-for-employees', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data as Department[]
    },
  })
}

function DepartmentSelect({
  departments,
  value,
  onChange,
}: {
  departments: Department[]
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('employeeDetail.noDepartment')}</SelectItem>
        {departments.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function LanguageSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LANG_OPTIONS.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>
            {lang.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
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

  // Én lukkevej: nulstiller altid ack/ord
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setAck(false)
      setWord('')
    }
    onOpenChange(next)
  }

  const run = async () => {
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('employees')
        .update({
          full_name: t('employeesActions.anonymizedName'),
          initials: null,
          email: null,
          phone: null,
          employee_no: null,
          is_active: false,
          anonymized_at: new Date().toISOString(),
        })
        .in('id', ids)
        .select('id')
      if (error) throw error
      if ((data?.length ?? 0) !== ids.length) {
        // RLS afviste (nogle af) skrivningerne — må ikke ligne succes
        toast.error(t('common.noPermission'))
        return
      }
      toast.success(t('employeesActions.anonymizedToast', { count: ids.length }))
      onDone()
      handleOpenChange(false)
    } catch (error) {
      console.error('Anonymisering fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
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

function EmployeeDetailPane({
  row,
  departments,
  onClose,
  onDirtyChange,
  onAnonymize,
  onDelete,
  refresh,
}: {
  row: Row
  departments: Department[]
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onAnonymize: () => void
  onDelete?: () => void // kun platform-admins (testdata-oprydning)
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')
  const [fullName, setFullName] = useState(row.full_name)
  const [firstName, setFirstName] = useState(row.first_name ?? '')
  const [lastName, setLastName] = useState(row.last_name ?? '')
  const [initials, setInitials] = useState(row.initials ?? '')
  const [phone, setPhone] = useState(row.phone ?? '')
  const [email, setEmail] = useState(row.email ?? '')
  const [departmentId, setDepartmentId] = useState(row.department_id ?? NONE)
  const [role, setRole] = useState(row.role ?? '')
  const [employeeNo, setEmployeeNo] = useState(row.employee_no ?? '')
  const [nfcCardId, setNfcCardId] = useState(row.nfc_card_id ?? '')
  const [language, setLanguage] = useState(row.language)
  const [isActive, setIsActive] = useState(row.is_active)
  const [saving, setSaving] = useState(false)

  const dirty =
    fullName !== row.full_name ||
    firstName !== (row.first_name ?? '') ||
    lastName !== (row.last_name ?? '') ||
    initials !== (row.initials ?? '') ||
    phone !== (row.phone ?? '') ||
    email !== (row.email ?? '') ||
    departmentId !== (row.department_id ?? NONE) ||
    role !== (row.role ?? '') ||
    employeeNo !== (row.employee_no ?? '') ||
    nfcCardId !== (row.nfc_card_id ?? '') ||
    language !== row.language ||
    isActive !== row.is_active

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const save = async (fields: Database['public']['Tables']['employees']['Update']) => {
    setSaving(true)
    const { data, error } = await supabase
      .from('employees')
      .update(fields)
      .eq('id', row.id)
      .select('id')
    setSaving(false)
    if (error) {
      console.error('Kunne ikke gemme medarbejder:', error)
      // 23505 = unique_violation på (company_id, employee_no) eller nfc_card_id
      toast.error(error.code === '23505' ? t('employeeDetail.duplicateIdentifier') : describeError(error, t))
      return false
    }
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      return false
    }
    toast.success(t('settings.saved'))
    refresh()
    return true
  }

  const saveAll = async () => {
    const trimmedName = fullName.trim()
    if (!trimmedName) return
    await save({
      full_name: trimmedName,
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      initials: initials.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      department_id: departmentId === NONE ? null : departmentId,
      role: role.trim() || null,
      employee_no: employeeNo.trim() || null,
      nfc_card_id: nfcCardId.trim() || null,
      language,
      is_active: isActive,
    })
  }

  const cancel = () => {
    setFullName(row.full_name)
    setFirstName(row.first_name ?? '')
    setLastName(row.last_name ?? '')
    setInitials(row.initials ?? '')
    setPhone(row.phone ?? '')
    setEmail(row.email ?? '')
    setDepartmentId(row.department_id ?? NONE)
    setRole(row.role ?? '')
    setEmployeeNo(row.employee_no ?? '')
    setNfcCardId(row.nfc_card_id ?? '')
    setLanguage(row.language)
    setIsActive(row.is_active)
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
            {!row.is_manual && (
              <p className="rounded-md border border-status-neutral-to-bad/40 bg-status-neutral-to-bad/10 px-3 py-2 text-xs text-muted-foreground">
                {t('employeeDetail.importManagedHint')}
              </p>
            )}
            <Field label="ID">
              <div className="relative">
                <Input value={row.id} disabled className="pr-10 font-mono text-xs" />
                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                  <CopyButton value={row.id} label={t('detail.copyId')} />
                </div>
              </div>
            </Field>
            <Field label={t('employees.name')}>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <div className="grid max-w-2xl grid-cols-2 gap-4">
              <Field label={t('employeeDetail.firstName')}>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </Field>
              <Field label={t('employeeDetail.lastName')}>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </Field>
            </div>
            <Field label={t('employees.initials')}>
              <Input value={initials} onChange={(e) => setInitials(e.target.value)} />
            </Field>
            <Field label={t('employeeDetail.phone')}>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label={t('employees.email')}>
              <Input value={email} type="email" onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label={t('employees.department')}>
              <DepartmentSelect
                departments={departments}
                value={departmentId}
                onChange={setDepartmentId}
              />
            </Field>
            <Field label={t('employeeDetail.role')}>
              <Input value={role} onChange={(e) => setRole(e.target.value)} />
            </Field>
          </div>
        )}
        {tab === 'data' && (
          <div className="flex flex-col gap-5">
            <Field
              label={t('employeeDetail.employeeNo')}
              info={!row.is_manual ? t('employeeDetail.employeeNoLockedHint') : undefined}
            >
              {/* Importens upsert-nøgle: ændres den på en importeret række,
                  deaktiverer næste Flow 0-kørsel den rigtige medarbejder og
                  opretter en dublet — derfor låst for is_manual=false. */}
              <Input
                value={employeeNo}
                className="font-mono"
                disabled={!row.is_manual}
                onChange={(e) => setEmployeeNo(e.target.value)}
              />
            </Field>
            <Field label={t('employeeDetail.nfcCardId')}>
              <Input
                value={nfcCardId}
                className="font-mono"
                onChange={(e) => setNfcCardId(e.target.value)}
              />
            </Field>
            <Field label={t('employeeDetail.language')}>
              <LanguageSelect value={language} onChange={setLanguage} />
            </Field>
            <Field label={t('employeeDetail.active')}>
              <Select value={isActive ? 'yes' : 'no'} onValueChange={(v) => setIsActive(v === 'yes')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">{t('common.yes')}</SelectItem>
                  <SelectItem value="no">{t('common.no')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">{t('employeesActions.deactivate')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('employeeDetail.deactivateDescription')}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={saving || !row.is_active}
                onClick={() => save({ is_active: false })}
              >
                {t('employeesActions.deactivate')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('employeesActions.anonymize')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('employeeDetail.anonymizeDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={onAnonymize}>
                {t('employeesActions.anonymize')}
              </Button>
            </div>
            {onDelete && (
              <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
                <div>
                  <p className="text-[13px] font-[450] text-destructive">
                    {t('employeeDetail.delete')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('employeeDetail.deleteDescription')}
                  </p>
                </div>
                <Button size="sm" variant="destructive" onClick={onDelete}>
                  {t('employeeDetail.delete')}
                </Button>
              </div>
            )}
          </div>
        )}
      </DetailTabs>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={saveAll} disabled={saving || !fullName.trim()}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </>
  )
}

function NewEmployeeDialog({
  open,
  onOpenChange,
  companyId,
  departments,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  departments: Department[]
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [fullName, setFullName] = useState('')
  const [initials, setInitials] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [employeeNo, setEmployeeNo] = useState('')
  const [departmentId, setDepartmentId] = useState(NONE)
  const [busy, setBusy] = useState(false)

  const trimmed = fullName.trim()

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setFullName('')
      setInitials('')
      setEmail('')
      setPhone('')
      setEmployeeNo('')
      setDepartmentId(NONE)
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId || !trimmed) return
    setBusy(true)
    // is_manual=true: manuelt oprettede medarbejdere røres aldrig af Flow 0-importen.
    const { error } = await supabase.from('employees').insert({
      company_id: companyId,
      full_name: trimmed,
      initials: initials.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      employee_no: employeeNo.trim() || null,
      department_id: departmentId === NONE ? null : departmentId,
      is_manual: true,
    })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette medarbejder:', error)
      toast.error(
        error.code === '23505' ? t('employeeDetail.duplicateIdentifier') : describeError(error, t),
      )
      return
    }
    toast.success(t('employeeDetail.createdToast', { name: trimmed }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('employeeDetail.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-employee-name" className="text-label">
            {t('employees.name')}
          </Label>
          <Input
            id="new-employee-name"
            value={fullName}
            autoFocus
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-employee-initials" className="text-label">
              {t('employees.initials')}
            </Label>
            <Input
              id="new-employee-initials"
              value={initials}
              onChange={(e) => setInitials(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-employee-no" className="text-label">
              {t('employeeDetail.employeeNo')}
            </Label>
            <Input
              id="new-employee-no"
              value={employeeNo}
              className="font-mono"
              onChange={(e) => setEmployeeNo(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-employee-email" className="text-label">
            {t('employees.email')}
          </Label>
          <Input
            id="new-employee-email"
            value={email}
            type="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-employee-phone" className="text-label">
            {t('employeeDetail.phone')}
          </Label>
          <Input
            id="new-employee-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('employees.department')}</Label>
          <DepartmentSelect
            departments={departments}
            value={departmentId}
            onChange={setDepartmentId}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !trimmed || !companyId} onClick={create}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EmployeesPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useRows(companyId)
  const { data: departments } = useDepartments(companyId)
  const { data: access } = useAccess()
  const queryClient = useQueryClient()
  const [anonymizeIds, setAnonymizeIds] = useState<string[]>([])
  const [anonymizeOpen, setAnonymizeOpen] = useState(false)
  const [clearSelection, setClearSelection] = useState<(() => void) | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [paneDirty, setPaneDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['employees'] })

  const deactivate = async (ids: string[], clear: () => void) => {
    const { data: updated, error } = await supabase
      .from('employees')
      .update({ is_active: false })
      .in('id', ids)
      .select('id')
    if (error) {
      console.error('Deaktivering fejlede:', error)
      toast.error(describeError(error, t))
      return
    }
    if ((updated?.length ?? 0) !== ids.length) {
      toast.error(t('common.noPermission'))
      return
    }
    toast.success(t('employeesActions.deactivatedToast', { count: ids.length }))
    clear()
    refresh()
  }

  // Hård sletning kun for platform-admins (oprydning i testdata)
  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('employees')
      .delete()
      .in('id', ids)
      .select('id')
    if (error) throw error
    if ((deleted?.length ?? 0) !== ids.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste (delvist) sletning')
    }
    await refresh()
  }

  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    { key: 'full_name', header: t('employees.name'), sortable: true, sortValue: (r) => r.full_name },
    { key: 'initials', header: t('employees.initials'), sortable: true, sortValue: (r) => r.initials, render: (r) => r.initials ?? '—' },
    { key: 'department', header: t('employees.department'), sortable: true, sortValue: (r) => r.department?.name ?? null, render: (r) => r.department?.name ?? '—' },
    { key: 'email', header: t('employees.email'), sortable: true, sortValue: (r) => r.email, render: (r) => r.email ?? '—' },
    { key: 'is_active', header: t('employees.active'), sortable: true, sortValue: (r) => (r.is_active ? 1 : 0), render: (r) => (r.is_active ? t('common.yes') : t('common.no')) },
  ]

  const activeRow = data?.find((row) => row.id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
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
        toolbar={
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> {t('common.new')}
          </Button>
        }
        onRowClick={(row) => guarded(() => setActiveId((prev) => (prev === row.id ? null : row.id)))}
        activeRowId={activeId}
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
      {activeRow && (
        <EmployeeDetailPane
          key={activeRow.id}
          row={activeRow}
          departments={departments ?? []}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onAnonymize={() => {
            setAnonymizeIds([activeRow.id])
            setClearSelection(null)
            setAnonymizeOpen(true)
          }}
          onDelete={access?.isPlatformAdmin ? () => setDeleteOpen(true) : undefined}
          refresh={refresh}
        />
      )}
      {activeRow && (
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('employeeDetail.deleteTitle', { name: activeRow.full_name })}
          description={t('employeeDetail.deleteWarning')}
          acknowledgeText={t('employeeDetail.deleteAcknowledge')}
          confirmLabel={t('employeeDetail.delete')}
          onConfirm={async () => {
            await deleteRows([activeRow.id])
            toast.success(t('employeeDetail.deletedToast', { name: activeRow.full_name }))
            setActiveId(null)
          }}
        />
      )}
      <NewEmployeeDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        departments={departments ?? []}
        onCreated={refresh}
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

import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { KeyRound, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { GeneratablePasswordField } from '@/components/generatable-password-field'
import { ChangePasswordDialog } from '@/components/change-password-dialog'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { RoleChecklist } from '@/components/role-checklist'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useSession } from '@/hooks/use-session'
import { ASSIGNABLE_ROLES, roleLabelKey, type AppRole } from '@/lib/roles'
import { readEdgeError } from '@/lib/edge'
import { supabase } from '@/lib/supabase'

// Konfiguration → Brugere (managers; platform-admins for den valgte kunde):
// virksomhedens EGNE brugere med systemadgang (app_users) og deres roller
// (user_roles) — samme skærm som Operia → Brugere, men altid afgrænset til den
// aktuelle virksomhed (RLS + eq-filter), og invitationen er bundet til den.
// invite-user-funktionen genverificerer server-side at kalderen er manager for
// netop denne virksomhed (eller platform-admin).

export const Route = createFileRoute('/_app/configure/users')({
  component: CompanyUsersPage,
})

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short' })

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

// Kun den aktuelle virksomheds brugere — for managers begrænser RLS alligevel,
// men platform-admins kan se alt, så eq-filteret er det der afgrænser visningen.
function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['app-users', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_users')
        .select('user_id, full_name, email, created_at, company_id, user_roles (role)')
        .eq('company_id', companyId!)
        .order('full_name')
      if (error) throw error
      // DataTable kræver et `id`-felt; app_users' nøgle er user_id.
      return data.map((row) => ({ ...row, id: row.user_id }))
    },
  })
}

function rolesOf(row: Row): AppRole[] {
  return row.user_roles.map((r) => r.role)
}

function RoleBadges({ roles }: { roles: AppRole[] }) {
  const { t } = useTranslation()
  if (!roles.length) return <span className="text-muted-foreground">—</span>
  // Behold katalog-rækkefølgen (manager først) uanset databasens ordning.
  const ordered = ASSIGNABLE_ROLES.filter((r) => roles.includes(r.value))
  return (
    <div className="flex flex-wrap gap-1">
      {ordered.map((r) => (
        <Badge key={r.value} variant="secondary" className="font-normal">
          {t(r.labelKey)}
        </Badge>
      ))}
    </div>
  )
}

function UserDetailPane({
  row,
  isSelf,
  onClose,
  onDirtyChange,
  onRemoved,
  refresh,
}: {
  row: Row
  isSelf: boolean
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onRemoved: () => void
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')
  const [name, setName] = useState(row.full_name)
  const [roles, setRoles] = useState<Set<AppRole>>(new Set(rolesOf(row)))
  const [saving, setSaving] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)

  const initialRoles = rolesOf(row)
  const rolesKey = (set: Iterable<AppRole>) => [...set].sort().join(',')
  const dirty =
    name !== row.full_name || rolesKey(roles) !== rolesKey(initialRoles)

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const toggleRole = (role: AppRole, on: boolean) => {
    setRoles((prev) => {
      const next = new Set(prev)
      if (on) next.add(role)
      else next.delete(role)
      return next
    })
  }

  const saveAll = async () => {
    setSaving(true)
    const trimmedName = name.trim()

    if (trimmedName !== row.full_name) {
      const { data, error } = await supabase
        .from('app_users')
        .update({ full_name: trimmedName })
        .eq('user_id', row.user_id)
        .select('user_id')
      if (error || !data?.length) {
        setSaving(false)
        toast.error(error ? describeError(error, t) : t('common.noPermission'))
        return
      }
    }

    const toAdd = [...roles].filter((r) => !initialRoles.includes(r))
    const toRemove = initialRoles.filter((r) => !roles.has(r))

    // Tilføj FØR vi fjerner. En manager der redigerer sin egen række og bytter
    // 'manager' ud med andre roller ville ellers miste manager-rettigheden
    // mellem DELETE og INSERT, så user_roles_write afviser insert'et og
    // efterlader brugeren helt uden roller (låst ude). Rækkefølgen her holder
    // manager-rollen til stede, indtil de nye roller er skrevet.
    if (toAdd.length) {
      const { data, error } = await supabase
        .from('user_roles')
        .insert(toAdd.map((role) => ({ user_id: row.user_id, role })))
        .select('role')
      if (error || (data?.length ?? 0) !== toAdd.length) {
        setSaving(false)
        toast.error(error ? describeError(error, t) : t('common.noPermission'))
        return
      }
    }
    if (toRemove.length) {
      const { data, error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', row.user_id)
        .in('role', toRemove)
        .select('role')
      if (error || (data?.length ?? 0) !== toRemove.length) {
        setSaving(false)
        toast.error(error ? describeError(error, t) : t('common.noPermission'))
        return
      }
    }

    setSaving(false)
    setName(trimmedName)
    toast.success(t('settings.saved'))
    refresh()
  }

  const cancel = () => {
    setName(row.full_name)
    setRoles(new Set(rolesOf(row)))
  }

  const remove = async () => {
    const { data, error } = await supabase
      .from('app_users')
      .delete()
      .eq('user_id', row.user_id)
      .select('user_id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste fjernelse')
    }
    toast.success(t('userDetail.removedToast', { name: row.full_name || row.email }))
    onRemoved()
    refresh()
  }

  const tabs = [
    { key: 'details', label: t('detail.tabDetails') },
    { key: 'access', label: t('userDetail.tabAccess') },
    { key: 'actions', label: t('detail.tabActions') },
  ]

  return (
    <>
      <DetailTabs tabs={tabs} active={tab} onChange={setTab} onClose={onClose}>
        {tab === 'details' && (
          <div className="flex flex-col gap-5">
            <Field label="ID">
              <div className="relative">
                <Input value={row.user_id} disabled className="pr-10 font-mono text-xs" />
                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                  <CopyButton value={row.user_id} label={t('detail.copyId')} />
                </div>
              </div>
            </Field>
            <Field label={t('userDetail.fullName')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('userDetail.email')} info={t('userDetail.emailHint')}>
              <Input value={row.email ?? '—'} disabled />
            </Field>
          </div>
        )}
        {tab === 'access' && (
          <div className="flex max-w-4xl flex-col gap-4">
            <p className="text-xs text-muted-foreground">{t('userDetail.accessHint')}</p>
            <RoleChecklist roles={roles} onToggle={toggleRole} />
          </div>
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">{t('changePassword.title')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('changePassword.cardHint')}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setPwOpen(true)}>
                <KeyRound className="size-3.5" />
                {t('changePassword.title')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('userDetail.remove')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isSelf ? t('userDetail.selfHint') : t('userDetail.removeDescription')}
                </p>
              </div>
              <Button
                size="sm"
                variant="destructive"
                disabled={isSelf}
                onClick={() => setRemoveOpen(true)}
              >
                {t('userDetail.remove')}
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

      <ChangePasswordDialog
        open={pwOpen}
        onOpenChange={setPwOpen}
        userId={row.user_id}
        email={row.email}
      />

      <ConfirmDeleteDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t('userDetail.removeTitle', { name: row.full_name || row.email })}
        description={t('userDetail.removeWarning')}
        acknowledgeText={t('userDetail.removeAcknowledge')}
        confirmLabel={t('userDetail.remove')}
        onConfirm={remove}
      />
    </>
  )
}

// Som Operia-udgaven, men uden virksomhedsvælger — invitationen er altid
// bundet til den aktuelle virksomhed.
function InviteUserDialog({
  open,
  onOpenChange,
  companyId,
  onInvited,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  onInvited: () => void
}) {
  const { t } = useTranslation()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [invite, setInvite] = useState(false)
  const [password, setPassword] = useState('')
  const [roles, setRoles] = useState<Set<AppRole>>(new Set())
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setFullName('')
    setEmail('')
    setInvite(false)
    setPassword('')
    setRoles(new Set())
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const toggleRole = (role: AppRole, on: boolean) => {
    setRoles((prev) => {
      const next = new Set(prev)
      if (on) next.add(role)
      else next.delete(role)
      return next
    })
  }

  const submit = async () => {
    if (!email.trim() || roles.size === 0) return
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: {
        companyId,
        email: email.trim(),
        fullName: fullName.trim(),
        roles: [...roles],
        sendInvitation: invite,
        password: invite ? undefined : password || undefined,
      },
    })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke invitere bruger:', error)
      toast.error(await readEdgeError(error, t('common.error'), { email_exists: t('common.emailExists') }))
      return
    }
    if (invite && data?.emailSent === false) {
      toast.warning(t('common.emailFailed'))
    } else {
      toast.success(
        invite
          ? t('userDetail.invitedToast', { email: email.trim() })
          : t('userDetail.createdToast', { email: email.trim() }),
      )
    }
    onInvited()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('userDetail.inviteTitle')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-name" className="text-label">
            {t('userDetail.fullName')}
          </Label>
          <Input id="invite-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-email" className="text-label">
            {t('userDetail.email')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            autoFocus
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <p className="text-[13px] font-[450]">{t('userDetail.sendInvitation')}</p>
            <p className="text-xs text-muted-foreground">{t('userDetail.sendInvitationHint')}</p>
          </div>
          <Switch checked={invite} onCheckedChange={setInvite} />
        </label>

        {!invite && (
          <GeneratablePasswordField
            id="invite-pw"
            label={
              <>
                {t('userDetail.password')}{' '}
                <span className="font-normal text-muted-foreground">
                  ({t('userDetail.passwordOptional')})
                </span>
              </>
            }
            value={password}
            onChange={setPassword}
            placeholder={t('userDetail.passwordPlaceholder')}
          />
        )}

        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('userDetail.rolesLabel')}</Label>
          <RoleChecklist roles={roles} onToggle={toggleRole} compact />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !email.trim() || roles.size === 0} onClick={submit}>
            {busy
              ? invite
                ? t('userDetail.sending')
                : t('common.loading')
              : t('userDetail.invite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CompanyUsersPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { session } = useSession()
  const currentUserId = session?.user.id ?? null
  const { data, isPending } = useRows(companyId)
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [paneDirty, setPaneDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)

  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['app-users'] })

  const deleteRows = async (ids: string[]) => {
    if (currentUserId && ids.includes(currentUserId)) {
      toast.error(t('userDetail.selfHint'))
      throw new Error('Kan ikke fjerne egen adgang')
    }
    const { data: deleted, error } = await supabase
      .from('app_users')
      .delete()
      .in('user_id', ids)
      .select('user_id')
    if (error) throw error
    if ((deleted?.length ?? 0) !== ids.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste (delvist) fjernelse')
    }
    if (activeId && ids.includes(activeId)) setActiveId(null)
    await refresh()
  }

  if (!companyId || isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    {
      key: 'full_name',
      header: t('usersPage.name'),
      sortable: true,
      sortValue: (r) => r.full_name,
      render: (r) => (
        <span>
          {r.full_name || '—'}
          {r.user_id === currentUserId && (
            <span className="ml-1.5 text-xs text-muted-foreground">({t('userDetail.you')})</span>
          )}
        </span>
      ),
    },
    {
      key: 'email',
      header: t('usersPage.email'),
      sortable: true,
      sortValue: (r) => r.email,
      render: (r) => <span className="block max-w-56 truncate">{r.email ?? '—'}</span>,
    },
    {
      key: 'roles',
      header: t('usersPage.roles'),
      render: (r) => <RoleBadges roles={rolesOf(r)} />,
    },
    {
      key: 'created_at',
      header: t('usersPage.created'),
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => dateFormat.format(new Date(r.created_at)),
    },
  ]

  const activeRow = data?.find((row) => row.user_id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('nav.users').toLowerCase()}
        searchText={(row) =>
          [row.full_name, row.email, ...rolesOf(row).map((r) => t(roleLabelKey[r]))]
            .filter(Boolean)
            .join(' ')
        }
        storageKey="company-users"
        toolbar={
          <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
            <Plus className="size-4" /> {t('userDetail.invite')}
          </Button>
        }
        onRowClick={(row) =>
          guarded(() => setActiveId(row.user_id === activeId ? null : row.user_id))
        }
        activeRowId={activeId}
        onDelete={deleteRows}
      />
      {activeRow && (
        <UserDetailPane
          key={activeRow.user_id}
          row={activeRow}
          isSelf={activeRow.user_id === currentUserId}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onRemoved={() => setActiveId(null)}
          refresh={refresh}
        />
      )}
      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        companyId={companyId}
        onInvited={refresh}
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

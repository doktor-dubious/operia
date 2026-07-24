import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Check, ChevronsUpDown, KeyRound, Plus, ShieldCheck, UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { GeneratablePasswordField } from '@/components/generatable-password-field'
import { ChangePasswordDialog } from '@/components/change-password-dialog'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { type Company } from '@/components/company-provider'
import { RoleChecklist } from '@/components/role-checklist'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useSession } from '@/hooks/use-session'
import { ASSIGNABLE_ROLES, roleLabelKey, type AppRole } from '@/lib/roles'
import { readEdgeError } from '@/lib/edge'
import { supabase } from '@/lib/supabase'
import { startImpersonation } from '@/lib/impersonation'

// Operia → Brugere (kun platform-admins): virksomhedens brugere med systemadgang
// (app_users) og deres roller (user_roles). Ligger under Operia-konfigurationen,
// da kun platform-admins må invitere nye brugere. Samme mønster som stamdata-
// siderne: redigerbart panel, gem/annullér-bjælke, ugemt-vagt og beskyttet
// fjernelse. Brugere er bundet til en auth-konto (FK), så oprettelse sker via
// invitation (kræver en service-role Edge Function) — derfor ingen "+ Ny" her.

export const Route = createFileRoute('/_app/operia/users')({
  component: UsersPage,
})

// 'final_receiver' udelades bevidst af rollekataloget (lib/roles.ts): rollen
// giver ingen adgang (kun i enum'et) og modtagere er medarbejder-kartoteket
// uden systemadgang.

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short' })
const dateTimeFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

// Fælles rækketype for både app_users og platform-admin-konti uden app_users-
// række (adminOnly). Eksplicit typet så union'en nedenfor ikke udleder en bred
// type — og så `Row` bliver forudsigelig for kolonner og detaljepanel.
type UserRow = {
  id: string
  user_id: string
  full_name: string
  email: string | null
  created_at: string
  company_id: string | null
  company: { name: string } | null
  user_roles: { role: AppRole }[]
  verified: boolean
  lastLogin: string | null
  isPlatformAdmin: boolean
  // DCA-super-tenant-konto uden app_users-række: ingen virksomhed/roller, og kan
  // ikke redigeres/slettes fra denne side (administreres i Supabase).
  adminOnly: boolean
}

type Row = UserRow

// Platform-admin-visning: alle virksomheders brugere på tværs af tenants (RLS
// tillader platform-admins at læse alt). Virksomhedsnavnet embeddes så det kan
// vises som kolonne. Oveni fletter vi DCA's platform-admin-konti ind — også dem
// uden app_users-række — så super-tenant-brugerne er synlige her.
function useRows() {
  return useQuery({
    queryKey: ['app-users'],
    queryFn: async (): Promise<UserRow[]> => {
      const [
        { data, error },
        { data: verification, error: verifyError },
        { data: admins, error: adminError },
      ] = await Promise.all([
        supabase
          .from('app_users')
          .select('user_id, full_name, email, created_at, company_id, company:companies (name), user_roles (role)')
          .order('full_name'),
        // Verifikationsstatus fra auth.users (accepteret invitation = bekræftet
        // e-mail) via platform-admin-RPC — kan ikke embeddes i selecten ovenfor.
        supabase.rpc('admin_user_verification'),
        // Platform-admin-konti (super-tenant) med e-mail + verifikation, også
        // dem uden app_users-række — se admin_platform_admins-migrationen.
        supabase.rpc('admin_platform_admins'),
      ])
      if (error) throw error
      if (verifyError) throw verifyError
      if (adminError) throw adminError
      const confirmedAt = new Map(verification.map((v) => [v.user_id, v.email_confirmed_at]))
      const lastSignInAt = new Map(verification.map((v) => [v.user_id, v.last_sign_in_at]))
      const adminById = new Map(admins.map((a) => [a.user_id, a]))

      // DataTable kræver et `id`-felt; app_users' nøgle er user_id.
      const rows: UserRow[] = data.map((row) => ({
        ...row,
        id: row.user_id,
        verified: confirmedAt.get(row.user_id) != null,
        lastLogin: lastSignInAt.get(row.user_id) ?? null,
        isPlatformAdmin: adminById.has(row.user_id),
        adminOnly: false,
      }))

      // Flet platform-admins ind, der ikke allerede har en app_users-række.
      const seen = new Set(rows.map((r) => r.user_id))
      for (const a of admins) {
        if (seen.has(a.user_id)) continue
        rows.push({
          id: a.user_id,
          user_id: a.user_id,
          full_name: '',
          email: a.email,
          created_at: a.created_at,
          company_id: null,
          company: null,
          user_roles: [],
          verified: a.email_confirmed_at != null,
          lastLogin: a.last_sign_in_at ?? null,
          isPlatformAdmin: true,
          adminOnly: true,
        })
      }
      rows.sort((x, y) => x.full_name.localeCompare(y.full_name, 'da'))
      return rows
    },
  })
}

function rolesOf(row: Row): AppRole[] {
  return row.user_roles.map((r) => r.role)
}

type DeleteError = { userId: string; error: string }

// Oversæt delete-user-funktionens fejlkoder til en læsbar besked (første fejl).
function deleteErrorMessage(errors: DeleteError[] | undefined, t: (k: string) => string): string {
  const code = errors?.[0]?.error
  if (code === 'cannot_delete_platform_admin') return t('userDetail.cannotDeletePlatformAdmin')
  if (code === 'cannot_delete_self') return t('userDetail.selfHint')
  return t('common.noPermission')
}

// Slet én eller flere brugere via Edge Function'en (fjerner auth.users-login +
// app_users via cascade). Kaster ved fejl, så DataTable/panelet viser en fejl.
async function deleteUsers(userIds: string[], t: (k: string) => string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-user', {
    body: { userIds },
  })
  if (error) throw new Error(await readEdgeError(error, t('common.error')))
  const deleted: string[] = data?.deleted ?? []
  if (deleted.length !== userIds.length) {
    // Vis den venlige besked her; kast en teknisk markør så kalderens
    // catch-log har kontekst (samme mønster som den tidligere RLS-sti).
    toast.error(deleteErrorMessage(data?.errors, t))
    throw new Error('delete-user afviste (delvist) sletning')
  }
}

// Hold rollekolonnen kompakt: vis højst 2 badges, og saml resten i et
// "+N mere"-badge, hvis hover viser den fulde liste. Ellers kan en bruger med
// mange roller skubbe kolonnerne skævt.
const MAX_VISIBLE_ROLES = 2

function RoleBadges({ roles }: { roles: AppRole[] }) {
  const { t } = useTranslation()
  if (!roles.length) return <span className="text-muted-foreground">—</span>
  // Behold katalog-rækkefølgen (manager først) uanset databasens ordning.
  const ordered = ASSIGNABLE_ROLES.filter((r) => roles.includes(r.value))
  const visible = ordered.slice(0, MAX_VISIBLE_ROLES)
  const overflow = ordered.slice(MAX_VISIBLE_ROLES)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((r) => (
        <Badge key={r.value} variant="secondary" className="font-normal">
          {t(r.labelKey)}
        </Badge>
      ))}
      {overflow.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Klik åbner detaljepanelet som resten af rækken; badge'et er kun til hover. */}
            <Badge variant="outline" className="cursor-default font-normal text-muted-foreground">
              {t('usersPage.moreRoles', { count: overflow.length })}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="flex flex-col gap-1">
              {ordered.map((r) => (
                <span key={r.value}>{t(r.labelKey)}</span>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
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
  const [impersonating, setImpersonating] = useState(false)

  // Impersonering: kun tilgængelig for mål der IKKE selv er platform-admin.
  // Siden er i forvejen platform-admin-only (operia.tsx-vagten), så kalderen er
  // altid en super-tenant her; edge-funktionen genverificerer alligevel.
  const canImpersonate = !row.isPlatformAdmin && !isSelf
  const onImpersonate = async () => {
    setImpersonating(true)
    try {
      await startImpersonation(row.user_id, row.full_name || row.email || '')
      // Ved succes genindlæser startImpersonation appen som målbrugeren.
    } catch (e) {
      setImpersonating(false)
      const code = e instanceof Error ? e.message : 'impersonate_failed'
      const key = `impersonate.error.${code}`
      const msg = t(key)
      toast.error(msg === key ? t('impersonate.error.impersonate_failed') : msg)
    }
  }

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
    await deleteUsers([row.user_id], t)
    toast.success(t('userDetail.removedToast', { name: row.full_name || row.email }))
    onRemoved()
    refresh()
  }

  // Platform-admin uden app_users-række: intet at redigere/slette her (roller og
  // virksomhed findes ikke, og kontoen administreres bevidst i Supabase). Vis en
  // skrivebeskyttet detaljevisning i stedet for det redigerbare panel.
  if (row.adminOnly) {
    return (
      <DetailTabs
        tabs={[{ key: 'details', label: t('detail.tabDetails') }]}
        active="details"
        onChange={() => {}}
        onClose={onClose}
      >
        <div className="flex flex-col gap-5">
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            {t('userDetail.platformAdminNote')}
          </div>
          <Field label="ID">
            <div className="relative">
              <Input value={row.user_id} disabled className="pr-10 font-mono text-xs" />
              <div className="absolute right-1 top-1/2 -translate-y-1/2">
                <CopyButton value={row.user_id} label={t('detail.copyId')} />
              </div>
            </div>
          </Field>
          <Field label={t('userDetail.email')}>
            <Input value={row.email ?? '—'} disabled />
          </Field>
        </div>
      </DetailTabs>
    )
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
            {canImpersonate && (
              <div className="flex items-center justify-between rounded-md border p-4">
                <div>
                  <p className="text-[13px] font-[450]">{t('impersonate.title')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('impersonate.cardHint')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={impersonating}
                  onClick={onImpersonate}
                >
                  <UserCog className="size-3.5" />
                  {impersonating ? t('common.loading') : t('impersonate.action')}
                </Button>
              </div>
            )}
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


function InviteUserDialog({
  open,
  onOpenChange,
  companies,
  defaultCompanyId,
  onInvited,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companies: Company[]
  defaultCompanyId: string | null
  onInvited: () => void
}) {
  const { t } = useTranslation()
  const [companyId, setCompanyId] = useState<string | null>(defaultCompanyId)
  const [companyOpen, setCompanyOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [invite, setInvite] = useState(false)
  const [password, setPassword] = useState('')
  const [roles, setRoles] = useState<Set<AppRole>>(new Set())
  const [busy, setBusy] = useState(false)

  // Forudvælg den aktive virksomhed hver gang dialogen åbnes.
  useEffect(() => {
    if (open) setCompanyId(defaultCompanyId)
  }, [open, defaultCompanyId])

  const reset = () => {
    setCompanyId(defaultCompanyId)
    setCompanyOpen(false)
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
    if (!companyId || !email.trim() || roles.size === 0) return
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
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('userDetail.inviteTitle')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label className="text-label">
            {t('userDetail.company')} <span className="text-destructive">*</span>
          </Label>
          <Popover open={companyOpen} onOpenChange={setCompanyOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={companyOpen}
                className="justify-between font-normal"
              >
                <span className="truncate">
                  {companies.find((c) => c.id === companyId)?.name ??
                    t('userDetail.companyPlaceholder')}
                </span>
                <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
              <Command>
                <CommandInput placeholder={t('companySwitcher.search')} />
                <CommandList>
                  <CommandEmpty>{t('companySwitcher.noResults')}</CommandEmpty>
                  <CommandGroup>
                    {companies.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.name}
                        onSelect={() => {
                          setCompanyId(c.id)
                          setCompanyOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 size-4',
                            companyId === c.id ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span className="truncate">{c.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

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
          <Button disabled={busy || !email.trim() || !companyId || roles.size === 0} onClick={submit}>
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

function UsersPage() {
  const { t } = useTranslation()
  const { companyId, companies } = useCompanyContext()
  const { session } = useSession()
  const currentUserId = session?.user.id ?? null
  const { data, isPending } = useRows()
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
    try {
      await deleteUsers(ids, t)
    } finally {
      // Delvis succes er mulig (fx en platform-admin blandt de valgte, som
      // funktionen afviser) — genindlæs altid, så de faktisk slettede rækker
      // forsvinder fra tabellen i stedet for at stå som spøgelsesrækker.
      if (activeId && ids.includes(activeId)) setActiveId(null)
      await refresh()
    }
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

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
      key: 'company',
      header: t('usersPage.company'),
      sortable: true,
      sortValue: (r) => r.company?.name ?? '',
      render: (r) => <span className="block max-w-48 truncate">{r.company?.name ?? '—'}</span>,
    },
    {
      key: 'roles',
      header: t('usersPage.roles'),
      render: (r) => <RoleBadges roles={rolesOf(r)} />,
    },
    {
      key: 'superuser',
      header: t('usersPage.superuser'),
      sortable: true,
      sortValue: (r) => (r.isPlatformAdmin ? 1 : 0),
      render: (r) =>
        r.isPlatformAdmin ? (
          <Badge variant="secondary" className="font-normal">
            <ShieldCheck className="size-3" /> {t('usersPage.superuserYes')}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'verified',
      header: t('usersPage.verified'),
      sortable: true,
      sortValue: (r) => (r.verified ? 1 : 0),
      render: (r) =>
        r.verified ? (
          <Badge variant="secondary" className="font-normal">
            <Check className="size-3" /> {t('usersPage.verifiedYes')}
          </Badge>
        ) : (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {t('usersPage.verifiedNo')}
          </Badge>
        ),
    },
    {
      key: 'last_login',
      header: t('usersPage.lastLogin'),
      sortable: true,
      // Sortér på tidsstempel; aldrig-loggede-ind sidst (0 = ældst).
      sortValue: (r) => (r.lastLogin ? new Date(r.lastLogin).getTime() : 0),
      render: (r) =>
        r.lastLogin ? (
          dateTimeFormat.format(new Date(r.lastLogin))
        ) : (
          <span className="text-muted-foreground">{t('usersPage.lastLoginNever')}</span>
        ),
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
          [row.full_name, row.email, row.company?.name, ...rolesOf(row).map((r) => t(roleLabelKey[r]))]
            .filter(Boolean)
            .join(' ')
        }
        storageKey="app-users"
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
        companies={companies}
        defaultCompanyId={companyId}
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

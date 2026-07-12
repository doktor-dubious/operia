import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { supabase } from '@/lib/supabase'

// Operia → Fragtfirmaer: DCA's egne forsendelsesaftaler (aggregator-konti og
// direkte fragtfirma-aftaler) som marginmodellen booker på. Kun platform-
// admins — kunderne har deres egen fragtfirma-stamdata under /carriers.
// api_key er skriv-kun i databasen (kolonne-grants): den kan sættes og
// udskiftes, men aldrig læses tilbage — has_key driver "nøgle sat"-visningen.
export const Route = createFileRoute('/_app/operia/carriers')({
  component: AgreementsPage,
})

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short' })

const PROVIDERS = ['webshipper', 'sendcloud', 'coolrunner', 'shipbook', 'other'] as const

// Udbydernavne er varemærker — kun 'other' oversættes.
function providerLabel(provider: string, t: (key: string) => string) {
  if (provider === 'other') return t('carrierAgreements.providerOther')
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}

type Row = NonNullable<ReturnType<typeof useAgreements>['data']>[number]

function useAgreements() {
  return useQuery({
    queryKey: ['carrier-agreements'],
    queryFn: async () => {
      // api_key kan ikke læses (kolonne-grants) — vælg aldrig '*' her.
      // Kun DCA's egne aftaler; kundernes (BYOC) har company_id sat.
      const { data, error } = await supabase
        .from('carrier_agreements')
        .select('id, agreement_type, provider, name, api_user, account_no, has_key, is_active, created_at')
        .is('company_id', null)
        .order('created_at')
      if (error) throw error
      return data
    },
  })
}

function AgreementDetailPane({
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
  const [name, setName] = useState(row.name ?? '')
  const [apiUser, setApiUser] = useState(row.api_user ?? '')
  const [accountNo, setAccountNo] = useState(row.account_no ?? '')
  const [newKey, setNewKey] = useState('')
  const [replacingKey, setReplacingKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const dirty =
    name !== (row.name ?? '') ||
    apiUser !== (row.api_user ?? '') ||
    accountNo !== (row.account_no ?? '')

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const save = async () => {
    setSaving(true)
    const { data, error } = await supabase
      .from('carrier_agreements')
      .update({
        name: name.trim() || null,
        api_user: apiUser.trim() || null,
        account_no: accountNo.trim() || null,
      })
      .eq('id', row.id)
      .select('id')
    setSaving(false)
    if (error || !data?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const cancel = () => {
    setName(row.name ?? '')
    setApiUser(row.api_user ?? '')
    setAccountNo(row.account_no ?? '')
  }

  // Nøglen skrives direkte (uden om gem-bjælken) og kan aldrig læses igen.
  const replaceKey = async () => {
    if (!newKey.trim()) return
    setReplacingKey(true)
    const { data, error } = await supabase
      .from('carrier_agreements')
      .update({ api_key: newKey.trim() })
      .eq('id', row.id)
      .select('id')
    setReplacingKey(false)
    if (error || !data?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    setNewKey('')
    toast.success(t('carrierAgreements.keyReplaced'))
    refresh()
  }

  const setActive = async (is_active: boolean) => {
    const { data, error } = await supabase
      .from('carrier_agreements')
      .update({ is_active })
      .eq('id', row.id)
      .select('id')
    if (error || !data?.length) {
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const remove = async () => {
    const { data, error } = await supabase
      .from('carrier_agreements')
      .delete()
      .eq('id', row.id)
      .select('id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste sletning')
    }
    toast.success(t('carrierAgreements.deletedToast', { name: displayName(row, t) }))
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
            <div className="grid max-w-2xl grid-cols-2 gap-4">
              <Field label={t('carrierAgreements.typeLabel')}>
                <Input
                  value={
                    row.agreement_type === 'aggregator'
                      ? t('carrierAgreements.typeAggregator')
                      : t('carrierAgreements.typeCarrier')
                  }
                  disabled
                />
              </Field>
              <Field label={t('carrierAgreements.provider')}>
                <Input value={providerLabel(row.provider, t)} disabled />
              </Field>
            </div>
            <Field label={t('carrierAgreements.name')}>
              <Input
                value={name}
                placeholder={t('carrierAgreements.namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label={t('carrierAgreements.apiUser')}>
              <Input value={apiUser} onChange={(e) => setApiUser(e.target.value)} />
            </Field>
            <Field label={t('carrierAgreements.accountNo')}>
              <Input value={accountNo} onChange={(e) => setAccountNo(e.target.value)} />
            </Field>
            <Field
              label={t('carrierAgreements.apiKey')}
              info={t('carrierAgreements.keyHint')}
            >
              <p className="text-xs text-muted-foreground">
                {row.has_key ? '•••• ' + t('carrierAgreements.keySet') : t('carrierAgreements.noKey')}
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  value={newKey}
                  placeholder={t('carrierAgreements.apiKeyPlaceholder')}
                  onChange={(e) => setNewKey(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={replacingKey || !newKey.trim()}
                  onClick={replaceKey}
                >
                  <KeyRound className="size-4" />
                  {replacingKey ? t('common.loading') : t('carrierAgreements.replaceKey')}
                </Button>
              </div>
            </Field>
          </div>
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">
                  {row.is_active
                    ? t('carrierAgreements.deactivate')
                    : t('carrierAgreements.activate')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('carrierAgreements.deactivateDescription')}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setActive(!row.is_active)}>
                {row.is_active
                  ? t('carrierAgreements.deactivate')
                  : t('carrierAgreements.activate')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('carrierAgreements.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('carrierAgreements.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('carrierAgreements.delete')}
              </Button>
            </div>
          </div>
        )}
      </DetailTabs>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('carrierAgreements.deleteTitle', { name: displayName(row, t) })}
        description={t('carrierAgreements.deleteWarning')}
        acknowledgeText={t('carrierAgreements.deleteAcknowledge')}
        confirmLabel={t('carrierAgreements.delete')}
        onConfirm={remove}
      />
    </>
  )
}

function displayName(row: Row, t: (key: string) => string) {
  return row.name?.trim() || providerLabel(row.provider, t)
}

function NewAgreementDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [type, setType] = useState<'aggregator' | 'carrier'>('aggregator')
  const [provider, setProvider] = useState<string>('other')
  const [name, setName] = useState('')
  const [apiUser, setApiUser] = useState('')
  const [accountNo, setAccountNo] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setType('aggregator')
      setProvider('other')
      setName('')
      setApiUser('')
      setAccountNo('')
      setApiKey('')
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!apiKey.trim()) return
    setBusy(true)
    const { data, error } = await supabase
      .from('carrier_agreements')
      .insert({
        agreement_type: type,
        provider,
        name: name.trim() || null,
        api_user: apiUser.trim() || null,
        account_no: accountNo.trim() || null,
        api_key: apiKey.trim(),
      })
      .select('id')
    setBusy(false)
    if (error || !data?.length) {
      console.error('Kunne ikke oprette aftale:', error)
      toast.error(error ? t('common.error') : t('common.noPermission'))
      return
    }
    toast.success(t('carrierAgreements.createdToast'))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('carrierAgreements.newTitle')}</DialogTitle>
          <DialogDescription>{t('carrierAgreements.newIntro')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('carrierAgreements.typeLabel')}</Label>
            <Select value={type} onValueChange={(v) => setType(v as 'aggregator' | 'carrier')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aggregator">
                  {t('carrierAgreements.typeAggregator')}
                </SelectItem>
                <SelectItem value="carrier">{t('carrierAgreements.typeCarrier')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('carrierAgreements.provider')}</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {providerLabel(p, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-label">
              {t('carrierAgreements.name')}{' '}
              <span className="font-normal text-muted-foreground">
                ({t('customerDetail.optional')})
              </span>
            </Label>
            <Input
              value={name}
              placeholder={t('carrierAgreements.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-label">
              {t('carrierAgreements.apiUser')}{' '}
              <span className="font-normal text-muted-foreground">
                ({t('customerDetail.optional')})
              </span>
            </Label>
            <Input value={apiUser} onChange={(e) => setApiUser(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-label">
            {t('carrierAgreements.accountNo')}{' '}
            <span className="font-normal text-muted-foreground">
              ({t('customerDetail.optional')})
            </span>
          </Label>
          <Input value={accountNo} onChange={(e) => setAccountNo(e.target.value)} />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('carrierAgreements.apiKey')}</Label>
          <Input
            type="password"
            value={apiKey}
            placeholder={t('carrierAgreements.apiKeyPlaceholder')}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !apiKey.trim()} onClick={create}>
            {busy ? t('common.loading') : t('carrierAgreements.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AgreementsPage() {
  const { t } = useTranslation()
  const { data, isPending } = useAgreements()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [paneDirty, setPaneDirty] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['carrier-agreements'] })

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('carrier_agreements')
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

  if (isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    {
      key: 'name',
      header: t('carrierAgreements.colName'),
      sortable: true,
      sortValue: (r) => displayName(r, t),
      render: (r) => displayName(r, t),
    },
    {
      key: 'agreement_type',
      header: t('carrierAgreements.typeLabel'),
      sortable: true,
      sortValue: (r) => r.agreement_type,
      render: (r) =>
        r.agreement_type === 'aggregator'
          ? t('carrierAgreements.typeAggregator')
          : t('carrierAgreements.typeCarrier'),
    },
    {
      key: 'provider',
      header: t('carrierAgreements.provider'),
      sortable: true,
      sortValue: (r) => r.provider,
      render: (r) => providerLabel(r.provider, t),
    },
    {
      key: 'has_key',
      header: t('carrierAgreements.colKey'),
      sortable: true,
      sortValue: (r) => (r.has_key ? 1 : 0),
      render: (r) =>
        r.has_key ? (
          <span className="font-mono text-xs">•••• {t('carrierAgreements.keySet')}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{t('carrierAgreements.noKey')}</span>
        ),
    },
    {
      key: 'is_active',
      header: t('carrierAgreements.colActive'),
      sortable: true,
      sortValue: (r) => (r.is_active ? 1 : 0),
      render: (r) => (r.is_active ? t('common.yes') : t('common.no')),
    },
    {
      key: 'created_at',
      header: t('carrierAgreements.colCreated'),
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => dateFormat.format(new Date(r.created_at)),
    },
  ]

  const activeRow = data?.find((row) => row.id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
      <header>
        <h1 className="text-2xl font-medium text-foreground">{t('nav.operiaCarriers')}</h1>
        <p className="mt-1 text-sm text-foreground-light">{t('carrierAgreements.subtitle')}</p>
      </header>

      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('carrierAgreements.entityLabel')}
        searchText={(row) =>
          [row.name, row.provider, row.api_user, row.account_no].filter(Boolean).join(' ')
        }
        storageKey="carrier-agreements"
        toolbar={
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> {t('common.new')}
          </Button>
        }
        onRowClick={(row) => guarded(() => setActiveId(row.id === activeId ? null : row.id))}
        activeRowId={activeId}
        onDelete={deleteRows}
      />

      {activeRow && (
        <AgreementDetailPane
          key={activeRow.id}
          row={activeRow}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onDeleted={() => setActiveId(null)}
          refresh={refresh}
        />
      )}

      <NewAgreementDialog open={newOpen} onOpenChange={setNewOpen} onCreated={refresh} />

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

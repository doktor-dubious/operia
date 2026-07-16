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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { InfoTip } from '@/components/info-tip'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { useCompanyContext } from '@/hooks/use-company-context'
import type { Database } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/lockers')({
  component: LockersPage,
})

// Skabe (smart lockers) — app-ejet stamdata for locker-produktet, samme
// mønster som fragtfirmaer: redigerbart panel, gem/annullér-bjælke,
// ugemt-vagt, beskyttet sletning og "+ Ny"-modal. Placeringen er en FK til
// storage_locations (bevidst strammere end prototypens fritekst).

const NONE = '__none__'

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['lockers', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lockers')
        .select(
          'id, name, keynius_bank_id, storage_location_id, cap_small, cap_medium, cap_large, is_active, location:storage_locations (name)',
        )
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function useLocations(companyId: string | null) {
  return useQuery({
    queryKey: ['locations-for-lockers', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('storage_locations')
        .select('id, name')
        .eq('company_id', companyId!)
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function CapacityFields({
  values,
  onChange,
}: {
  values: { small: string; medium: string; large: string }
  onChange: (values: { small: string; medium: string; large: string }) => void
}) {
  const { t } = useTranslation()
  const fields = [
    ['small', t('lockersPage.capSmall')],
    ['medium', t('lockersPage.capMedium')],
    ['large', t('lockersPage.capLarge')],
  ] as const
  return (
    <div className="grid max-w-2xl grid-cols-3 gap-4">
      {fields.map(([key, label]) => (
        <div key={key} className="flex flex-col gap-2">
          <Label className="text-label">{label}</Label>
          <Input
            type="number"
            min={0}
            value={values[key]}
            onChange={(e) => onChange({ ...values, [key]: e.target.value })}
          />
        </div>
      ))}
    </div>
  )
}

function LocationSelect({
  companyId,
  value,
  onChange,
}: {
  companyId: string | null
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const { data: locations } = useLocations(companyId)
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('lockerDetail.noLocation')}</SelectItem>
        {locations?.map((location) => (
          <SelectItem key={location.id} value={location.id}>
            {location.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function LockerDetailPane({
  row,
  companyId,
  existingNames,
  onClose,
  onDirtyChange,
  onDeleted,
  refresh,
}: {
  row: Row
  companyId: string | null
  existingNames: string[]
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onDeleted: () => void
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')
  const [name, setName] = useState(row.name)
  const [keynius, setKeynius] = useState(row.keynius_bank_id ?? '')
  const [locationId, setLocationId] = useState(row.storage_location_id ?? NONE)
  const [caps, setCaps] = useState({
    small: String(row.cap_small),
    medium: String(row.cap_medium),
    large: String(row.cap_large),
  })
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const dirty =
    name !== row.name ||
    keynius !== (row.keynius_bank_id ?? '') ||
    locationId !== (row.storage_location_id ?? NONE) ||
    caps.small !== String(row.cap_small) ||
    caps.medium !== String(row.cap_medium) ||
    caps.large !== String(row.cap_large)

  // Samme unikke-navn-tjek som "+ Ny", men mod de øvrige rækker (egen udeladt).
  const trimmedNameCheck = name.trim()
  const duplicate =
    trimmedNameCheck !== '' &&
    existingNames.some((n) => n.trim().toLowerCase() === trimmedNameCheck.toLowerCase())

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const save = async (fields: Database['public']['Tables']['lockers']['Update']) => {
    setSaving(true)
    const { data, error } = await supabase
      .from('lockers')
      .update(fields)
      .eq('id', row.id)
      .select('id')
    setSaving(false)
    if (error) {
      console.error('Kunne ikke gemme skab:', error)
      // 23505 = unique_violation på (company_id, name) — vis et præcist navn-svar
      toast.error(error.code === '23505' ? t('common.nameTaken') : describeError(error, t))
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
    if (duplicate) return
    const trimmedName = name.trim()
    const trimmedKeynius = keynius.trim()
    const ok = await save({
      name: trimmedName,
      keynius_bank_id: trimmedKeynius || null,
      storage_location_id: locationId === NONE ? null : locationId,
      cap_small: Math.max(0, parseInt(caps.small, 10) || 0),
      cap_medium: Math.max(0, parseInt(caps.medium, 10) || 0),
      cap_large: Math.max(0, parseInt(caps.large, 10) || 0),
    })
    if (ok) {
      setName(trimmedName)
      setKeynius(trimmedKeynius)
      setCaps({
        small: String(Math.max(0, parseInt(caps.small, 10) || 0)),
        medium: String(Math.max(0, parseInt(caps.medium, 10) || 0)),
        large: String(Math.max(0, parseInt(caps.large, 10) || 0)),
      })
    }
  }

  const cancel = () => {
    setName(row.name)
    setKeynius(row.keynius_bank_id ?? '')
    setLocationId(row.storage_location_id ?? NONE)
    setCaps({
      small: String(row.cap_small),
      medium: String(row.cap_medium),
      large: String(row.cap_large),
    })
  }

  const remove = async () => {
    const { data, error } = await supabase.from('lockers').delete().eq('id', row.id).select('id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste sletning')
    }
    toast.success(t('lockerDetail.deletedToast', { name: row.name }))
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
            <Field label={t('lockersPage.name')}>
              <Input
                value={name}
                aria-invalid={duplicate}
                onChange={(e) => setName(e.target.value)}
              />
              {duplicate && (
                <p className="mt-1.5 text-xs text-destructive">{t('common.nameTaken')}</p>
              )}
            </Field>
            <Field label={t('lockersPage.keynius')} info={t('lockerDetail.keyniusDescription')}>
              <Input
                value={keynius}
                className="font-mono"
                onChange={(e) => setKeynius(e.target.value)}
              />
            </Field>
            <Field label={t('lockersPage.location')}>
              <LocationSelect companyId={companyId} value={locationId} onChange={setLocationId} />
            </Field>
            <CapacityFields values={caps} onChange={setCaps} />
          </div>
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">
                  {row.is_active ? t('lockerDetail.deactivate') : t('lockerDetail.activate')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('lockerDetail.deactivateDescription')}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => save({ is_active: !row.is_active })}
              >
                {row.is_active ? t('lockerDetail.deactivate') : t('lockerDetail.activate')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('lockerDetail.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('lockerDetail.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('lockerDetail.delete')}
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
          <Button size="sm" onClick={saveAll} disabled={saving || !name.trim() || duplicate}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('lockerDetail.deleteTitle', { name: row.name })}
        description={t('lockerDetail.deleteWarning')}
        acknowledgeText={t('lockerDetail.deleteAcknowledge')}
        confirmLabel={t('lockerDetail.delete')}
        onConfirm={remove}
      />
    </>
  )
}

function NewLockerDialog({
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
  const [keynius, setKeynius] = useState('')
  const [locationId, setLocationId] = useState(NONE)
  const [caps, setCaps] = useState({ small: '0', medium: '0', large: '0' })
  const [busy, setBusy] = useState(false)

  // Navnet skal være unikt pr. virksomhed (DB: unique (company_id, name)) —
  // tjek det mens der skrives, uafhængigt af store/små bogstaver og mellemrum.
  const trimmed = name.trim()
  const duplicate =
    trimmed !== '' &&
    existingNames.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase())

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName('')
      setKeynius('')
      setLocationId(NONE)
      setCaps({ small: '0', medium: '0', large: '0' })
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId || !trimmed || duplicate) return
    setBusy(true)
    const { error } = await supabase.from('lockers').insert({
      company_id: companyId,
      name: trimmed,
      keynius_bank_id: keynius.trim() || null,
      storage_location_id: locationId === NONE ? null : locationId,
      cap_small: Math.max(0, parseInt(caps.small, 10) || 0),
      cap_medium: Math.max(0, parseInt(caps.medium, 10) || 0),
      cap_large: Math.max(0, parseInt(caps.large, 10) || 0),
    })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette skab:', error)
      // 23505 = unique_violation (fx et race med en anden manager)
      toast.error(error.code === '23505' ? t('common.nameTaken') : describeError(error, t))
      return
    }
    toast.success(t('lockerDetail.createdToast', { name: trimmed }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('lockerDetail.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-locker-name" className="text-label">
            {t('lockersPage.name')}
          </Label>
          <Input
            id="new-locker-name"
            value={name}
            autoFocus
            aria-invalid={duplicate}
            onChange={(e) => setName(e.target.value)}
          />
          {duplicate && <p className="text-xs text-destructive">{t('common.nameTaken')}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="new-locker-keynius" className="text-label">
              {t('lockersPage.keynius')}
            </Label>
            <InfoTip text={t('lockerDetail.keyniusDescription')} />
          </div>
          <Input
            id="new-locker-keynius"
            value={keynius}
            className="font-mono"
            onChange={(e) => setKeynius(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('lockersPage.location')}</Label>
          <LocationSelect companyId={companyId} value={locationId} onChange={setLocationId} />
        </div>
        <CapacityFields values={caps} onChange={setCaps} />
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !name.trim() || duplicate || !companyId} onClick={create}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LockersPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
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

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['lockers'] })

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('lockers')
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
    { key: 'name', header: t('lockersPage.name'), sortable: true, sortValue: (r) => r.name },
    {
      key: 'keynius',
      header: t('lockersPage.keynius'),
      sortable: true,
      sortValue: (r) => r.keynius_bank_id,
      render: (r) => <span className="font-mono text-xs">{r.keynius_bank_id ?? '—'}</span>,
    },
    {
      key: 'location',
      header: t('lockersPage.location'),
      sortable: true,
      sortValue: (r) => r.location?.name ?? null,
      render: (r) => r.location?.name ?? '—',
    },
    { key: 'cap_small', header: 'S', sortable: true, sortValue: (r) => r.cap_small, render: (r) => r.cap_small },
    { key: 'cap_medium', header: 'M', sortable: true, sortValue: (r) => r.cap_medium, render: (r) => r.cap_medium },
    { key: 'cap_large', header: 'L', sortable: true, sortValue: (r) => r.cap_large, render: (r) => r.cap_large },
    {
      key: 'is_active',
      header: t('lockersPage.active'),
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
        entityLabel={t('nav.lockersData').toLowerCase()}
        searchText={(row) =>
          [row.name, row.keynius_bank_id, row.location?.name].filter(Boolean).join(' ')
        }
        storageKey="lockers"
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
        <LockerDetailPane
          key={activeRow.id}
          row={activeRow}
          companyId={companyId}
          existingNames={(data ?? []).filter((r) => r.id !== activeRow.id).map((r) => r.name)}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onDeleted={() => setActiveId(null)}
          refresh={refresh}
        />
      )}
      <NewLockerDialog
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

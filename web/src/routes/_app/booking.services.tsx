import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
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
import { FieldLabel, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { CopyButton } from '@/components/copy-button'
import { BookingTariffFields } from '@/components/booking-tariff-fields'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useCompanyCurrency, formatMoney, servicePriceLabel } from '@/lib/booking-services'
import { supabase } from '@/lib/supabase'

// Tilkøbsydelser (EVU-krav A-06): den vedligeholdte ydelsesliste, som
// bookingens tilkøb vælges fra — forplejning, overnatning, rengøring og øvrige.
// App-ejet stamdata som ressourcer og kategorier: booking_managers CRUD'er
// frit (RLS: can_manage_bookings).
//
// Sletning er kun mulig for ydelser, der ALDRIG har været på en booking —
// fremmednøglen fra linjerne er 'restrict', så fakturagrundlaget ikke kan
// tømmes bagfra. Ellers deaktiveres ydelsen.
export const Route = createFileRoute('/_app/booking/services')({
  component: ServicesPage,
})

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

type ServiceValue = {
  name: string
  description: string
  has_quantity: boolean
  price_mode: 'unit' | 'total'
  unit_price: string
}

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['booking-services', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_services')
        .select('id, company_id, name, description, has_quantity, price_mode, unit_price, is_active')
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

/** Er ydelsen brugt på mindst én booking? Styrer om sletning kan tilbydes. */
function useUsage(companyId: string | null) {
  return useQuery({
    queryKey: ['booking-services', 'usage', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('booking_service_lines')
        .select('service_id')
        .eq('company_id', companyId!)
      if (error) throw error
      return new Set((data ?? []).map((r) => r.service_id))
    },
  })
}

function toValue(row: Row): ServiceValue {
  return {
    name: row.name,
    description: row.description ?? '',
    has_quantity: row.has_quantity,
    price_mode: row.price_mode === 'total' ? 'total' : 'unit',
    unit_price: String(row.unit_price ?? 0),
  }
}

function toPatch(v: ServiceValue) {
  return {
    name: v.name.trim(),
    description: v.description.trim() || null,
    has_quantity: v.has_quantity,
    // Uden antal findes kun ét samlet beløb — databasen håndhæver det samme.
    price_mode: v.has_quantity ? v.price_mode : 'total',
    unit_price: Number(v.unit_price.replace(',', '.')),
  }
}

function valueKey(v: ServiceValue): string {
  return JSON.stringify(toPatch(v))
}

function valueError(v: ServiceValue): string | null {
  if (!v.name.trim()) return 'nameRequired'
  const price = Number(v.unit_price.replace(',', '.'))
  if (!Number.isFinite(price) || price < 0) return 'priceInvalid'
  return null
}

/**
 * Konfigurationsfelterne. Ligger for sig, fordi de bruges både i
 * opret-dialogen og på detaljepanelets fane 2.
 */
function ServiceConfigFields({
  value,
  onChange,
  idPrefix,
  currency,
}: {
  value: ServiceValue
  onChange: (v: ServiceValue) => void
  idPrefix: string
  currency: string
}) {
  const { t } = useTranslation()
  const set = (patch: Partial<ServiceValue>) => onChange({ ...value, ...patch })

  return (
    <>
      <FieldLabel htmlFor={`${idPrefix}-qty`} className="px-2.5 py-1.5 font-normal">
        <Checkbox
          id={`${idPrefix}-qty`}
          checked={value.has_quantity}
          // Slås antal fra, findes kun ét samlet beløb — så nulstilles
          // pristypen, i stedet for at efterlade et valg der ikke vises.
          onCheckedChange={(v) =>
            set(v === true ? { has_quantity: true } : { has_quantity: false, price_mode: 'total' })
          }
        />
        <div className="flex flex-col gap-0.5">
          <FieldTitle>{t('bookingServicesPage.hasQuantity')}</FieldTitle>
          <span className="text-xs text-muted-foreground">
            {t('bookingServicesPage.hasQuantityHint')}
          </span>
        </div>
      </FieldLabel>

      {value.has_quantity && (
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingServicesPage.priceMode')}</Label>
          <RadioGroup
            value={value.price_mode}
            onValueChange={(v) => set({ price_mode: v as ServiceValue['price_mode'] })}
            className="flex flex-col gap-2"
          >
            <FieldLabel htmlFor={`${idPrefix}-unit`} className="px-2.5 py-1.5 font-normal">
              <RadioGroupItem id={`${idPrefix}-unit`} value="unit" />
              {t('bookingServicesPage.priceModeUnit')}
            </FieldLabel>
            <FieldLabel htmlFor={`${idPrefix}-total`} className="px-2.5 py-1.5 font-normal">
              <RadioGroupItem id={`${idPrefix}-total`} value="total" />
              {t('bookingServicesPage.priceModeTotal')}
            </FieldLabel>
          </RadioGroup>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-price`} className="text-label">
          {value.has_quantity && value.price_mode === 'unit'
            ? t('bookingServicesPage.priceUnit')
            : t('bookingServicesPage.priceTotal')}
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-price`}
            value={value.unit_price}
            inputMode="decimal"
            className="w-44"
            onChange={(e) => set({ unit_price: e.target.value })}
          />
          <span className="text-[13px] text-muted-foreground">{currency}</span>
        </div>
      </div>
    </>
  )
}

function ServiceDetailPane({
  row,
  usedIds,
  onClose,
  onDirtyChange,
  onDeleted,
  refresh,
  currency,
}: {
  row: Row
  usedIds: Set<string>
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onDeleted: () => void
  refresh: () => void
  currency: string
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')
  const [value, setValue] = useState<ServiceValue>(toValue(row))
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const dirty = valueKey(value) !== valueKey(toValue(row))
  const inUse = usedIds.has(row.id)

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const save = async () => {
    const invalid = valueError(value)
    if (invalid) {
      toast.error(t(`bookingServicesPage.${invalid}`))
      return
    }
    setSaving(true)
    const { data, error } = await supabase
      .from('booking_services')
      .update(toPatch(value))
      .eq('id', row.id)
      .select('id')
    setSaving(false)
    if (error || !data?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const setActive = async (is_active: boolean) => {
    const { data, error } = await supabase
      .from('booking_services')
      .update({ is_active })
      .eq('id', row.id)
      .select('id')
    if (error || !data?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const remove = async () => {
    const { data, error } = await supabase
      .from('booking_services')
      .delete()
      .eq('id', row.id)
      .select('id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste sletning')
    }
    toast.success(t('bookingServicesPage.deletedToast', { name: row.name }))
    onDeleted()
    refresh()
  }

  const tabs = [
    { key: 'details', label: t('detail.tabDetails') },
    { key: 'config', label: t('detail.tabConfiguration') },
    { key: 'prices', label: t('bookingTariffs.tab') },
    { key: 'actions', label: t('detail.tabActions') },
  ]

  return (
    <>
      <DetailTabs tabs={tabs} active={tab} onChange={setTab} onClose={onClose}>
        {tab === 'details' && (
          <div className="flex max-w-2xl flex-col gap-5">
            <Field label="ID">
              <div className="relative">
                <Input value={row.id} disabled className="pr-10 font-mono text-xs" />
                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                  <CopyButton value={row.id} label={t('detail.copyId')} />
                </div>
              </div>
            </Field>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`svc-${row.id}-name`} className="text-label">
                {t('bookingServicesPage.name')}
              </Label>
              <Input
                id={`svc-${row.id}-name`}
                value={value.name}
                placeholder={t('bookingServicesPage.namePlaceholder')}
                onChange={(e) => setValue({ ...value, name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`svc-${row.id}-desc`} className="text-label">
                {t('bookingServicesPage.description')}
              </Label>
              <Input
                id={`svc-${row.id}-desc`}
                value={value.description}
                onChange={(e) => setValue({ ...value, description: e.target.value })}
              />
            </div>
          </div>
        )}
        {tab === 'config' && (
          <div className="flex max-w-2xl flex-col gap-5">
            <ServiceConfigFields
              value={value}
              onChange={setValue}
              idPrefix={`svc-${row.id}`}
              currency={currency}
            />
          </div>
        )}
        {tab === 'prices' && (
          <BookingTariffFields
            companyId={row.company_id}
            scope="service"
            targetId={row.id}
            basePriceHint={t('bookingTariffs.serviceBaseHint')}
          />
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">
                  {row.is_active
                    ? t('bookingServicesPage.deactivate')
                    : t('bookingServicesPage.activate')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('bookingServicesPage.deactivateDescription')}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setActive(!row.is_active)}>
                {row.is_active
                  ? t('bookingServicesPage.deactivate')
                  : t('bookingServicesPage.activate')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('bookingServicesPage.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {inUse
                    ? t('bookingServicesPage.deleteBlocked')
                    : t('bookingServicesPage.deleteDescription')}
                </p>
              </div>
              {/* Knappen er slået fra for en ydelse i brug: databasen ville
                  afvise sletningen alligevel (FK 'restrict'), og en knap der
                  altid fejler er værre end ingen knap. */}
              <Button
                size="sm"
                variant="destructive"
                disabled={inUse}
                onClick={() => setDeleteOpen(true)}
              >
                {t('bookingServicesPage.delete')}
              </Button>
            </div>
          </div>
        )}
      </DetailTabs>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => setValue(toValue(row))} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !value.name.trim()}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('bookingServicesPage.deleteTitle', { name: row.name })}
        description={t('bookingServicesPage.deleteWarning')}
        acknowledgeText={t('bookingServicesPage.deleteAcknowledge')}
        confirmLabel={t('bookingServicesPage.delete')}
        onConfirm={remove}
      />
    </>
  )
}

const EMPTY_VALUE: ServiceValue = {
  name: '',
  description: '',
  has_quantity: true,
  price_mode: 'unit',
  unit_price: '0',
}

function NewServiceDialog({
  open,
  onOpenChange,
  companyId,
  onCreated,
  currency,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  onCreated: () => void
  currency: string
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState<ServiceValue>(EMPTY_VALUE)
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) setValue(EMPTY_VALUE)
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId) return
    const invalid = valueError(value)
    if (invalid) {
      toast.error(t(`bookingServicesPage.${invalid}`))
      return
    }
    setBusy(true)
    const { error } = await supabase
      .from('booking_services')
      .insert({ company_id: companyId, ...toPatch(value) })
    setBusy(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('bookingServicesPage.createdToast', { name: value.name.trim() }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('bookingServicesPage.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-svc-name" className="text-label">
              {t('bookingServicesPage.name')}
            </Label>
            <Input
              id="new-svc-name"
              value={value.name}
              placeholder={t('bookingServicesPage.namePlaceholder')}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-svc-desc" className="text-label">
              {t('bookingServicesPage.description')}
            </Label>
            <Input
              id="new-svc-desc"
              value={value.description}
              onChange={(e) => setValue({ ...value, description: e.target.value })}
            />
          </div>
          <ServiceConfigFields
            value={value}
            onChange={setValue}
            idPrefix="new-svc"
            currency={currency}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !value.name.trim() || !companyId} onClick={create}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ServicesPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useRows(companyId)
  const { data: usedIds } = useUsage(companyId)
  const currency = useCompanyCurrency(companyId)
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [paneDirty, setPaneDirty] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('booking'),
    })

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('booking_services')
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
    { key: 'name', header: t('bookingServicesPage.name'), sortable: true, sortValue: (r) => r.name },
    {
      key: 'price',
      header: t('bookingServicesPage.price'),
      sortable: true,
      sortValue: (r) => Number(r.unit_price ?? 0),
      render: (r) => formatMoney(Number(r.unit_price ?? 0), currency),
    },
    {
      key: 'mode',
      header: t('bookingServicesPage.priceMode'),
      sortable: true,
      sortValue: (r) => `${r.has_quantity ? 1 : 0}${r.price_mode}`,
      render: (r) => servicePriceLabel(r, t),
      filter: {
        options: [
          { value: 'unit', label: t('bookingServicesPage.priceModeUnit') },
          { value: 'total', label: t('bookingServicesPage.priceModeTotal') },
          { value: 'none', label: t('bookingServicesPage.noQuantity') },
        ],
        valueOf: (r) => (!r.has_quantity ? 'none' : r.price_mode === 'total' ? 'total' : 'unit'),
      },
    },
    {
      key: 'is_active',
      header: t('bookingServicesPage.active'),
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
        entityLabel={t('nav.bookingServices').toLowerCase()}
        searchText={(row) => [row.name, row.description].filter(Boolean).join(' ')}
        storageKey="booking-services"
        toolbar={
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> {t('common.new')}
          </Button>
        }
        onDelete={deleteRows}
        onRowClick={(row) => guarded(() => setActiveId(row.id === activeId ? null : row.id))}
        activeRowId={activeId}
      />
      {activeRow && (
        <ServiceDetailPane
          key={activeRow.id}
          row={activeRow}
          usedIds={usedIds ?? new Set()}
          currency={currency}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onDeleted={() => setActiveId(null)}
          refresh={refresh}
        />
      )}
      <NewServiceDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        currency={currency}
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

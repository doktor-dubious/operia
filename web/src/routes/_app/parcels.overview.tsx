import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { PackagePlus, ShieldAlert, Trash2 } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { CopyButton } from '@/components/copy-button'
import { ParcelStatusBadge, statusLabelKey } from '@/components/parcel-status-badge'
import { ParcelReceiveForm } from '@/components/parcel-receive-form'
import { ParcelHandoverDialog } from '@/components/parcel-handover-dialog'
import { ParcelRelocateDialog } from '@/components/parcel-relocate-dialog'
import { ParcelConditionTab } from '@/components/parcel-condition'
import { ParcelRemoveDialog, useCanRemoveParcel } from '@/components/parcel-remove-dialog'
import { moveTargets } from '@/lib/parcel-moves'
import { useCompanyContext } from '@/hooks/use-company-context'
import { supabase } from '@/lib/supabase'

export const Route = createFileRoute('/_app/parcels/overview')({
  component: ParcelsPage,
})

const dateFormat = new Intl.DateTimeFormat('da-DK', {
  dateStyle: 'short',
  timeStyle: 'short',
})

// Afvisning er kun en gyldig statusovergang fra disse tilstande (jf.
// parcel_transition_allowed i migrationen). Fx kan 'unassigned' og 'in_locker'
// ikke afvises direkte — så ville DB-triggeren afvise overgangen.
const REJECTABLE_STATUSES = ['registered', 'in_storage', 'in_transit']

// Udlevering (→ 'delivered') er tilladt fra disse åbne tilstande.
const DELIVERABLE_STATUSES = ['registered', 'in_storage', 'in_transit', 'in_locker']

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]

function useRows() {
  return useQuery({
    queryKey: ['parcels'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parcels')
        .select(
          `id, barcode, status, registered_at, sender, parcel_type, is_private, storage_location_id,
           delivered_to, delivered_note, delivered_at, condition_preset, condition_note, condition_photo_path,
           receiver_override_reason, receiver_override_at, receiver_override_by,
           removed_reason, removed_at, removed_by,
           receiver:employees!parcels_receiver_employee_id_fkey (full_name),
           delivered_employee:employees!parcels_delivered_employee_id_fkey (full_name),
           department:departments (name),
           location:storage_locations (name),
           carrier:carriers (name),
           handling:handling_classes (name, allow_proxy_collection)`,
        )
        .order('registered_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data
    },
  })
}

// --- Detaljepanel (skrivebeskyttet: pakker redigeres kun via Modtag/Udlever;
// sporbarheden er hele produktet). Handlinger-fanen tilbyder afvisning. ---

function ParcelDetailPane({
  row,
  companyId,
  onClose,
  refresh,
}: {
  row: Row
  companyId: string | null
  onClose: () => void
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [handoverOpen, setHandoverOpen] = useState(false)
  const [relocateOpen, setRelocateOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const canRemove = useCanRemoveParcel()

  // Godkenderen står som bruger-id på pakken (ingen FK til app_users, så ingen
  // embed) — navnet slås op når panelet faktisk viser en overstyring.
  const { data: overrideBy } = useQuery({
    queryKey: ['app-user-name', row.receiver_override_by],
    enabled: !!row.receiver_override_reason && !!row.receiver_override_by,
    queryFn: async () => {
      const { data } = await supabase
        .from('app_users')
        .select('full_name')
        .eq('user_id', row.receiver_override_by!)
        .maybeSingle()
      return data?.full_name ?? null
    },
  })

  const { data: removedBy } = useQuery({
    queryKey: ['app-user-name', row.removed_by],
    enabled: row.status === 'removed' && !!row.removed_by,
    queryFn: async () => {
      const { data } = await supabase
        .from('app_users')
        .select('full_name')
        .eq('user_id', row.removed_by!)
        .maybeSingle()
      return data?.full_name ?? null
    },
  })

  const canReject = REJECTABLE_STATUSES.includes(row.status)
  // En afsluttet pakke kan ikke annulleres — den skete faktisk.
  const canRemoveStatus = !['delivered', 'returned', 'removed'].includes(row.status)
  const canHandover = DELIVERABLE_STATUSES.includes(row.status)
  const canRelocate = moveTargets(row.status).length > 0

  const typeLabel = (ty: string) =>
    t(`parcelDetail.type${ty.charAt(0).toUpperCase()}${ty.slice(1)}`)

  const reject = async () => {
    setBusy(true)
    const { data, error } = await supabase
      .from('parcels')
      .update({ status: 'rejected', delivered_note: reason.trim() || null })
      .eq('id', row.id)
      .select('id')
    setBusy(false)
    if (error) {
      console.error('Kunne ikke afvise pakke:', error)
      toast.error(describeError(error, t))
      return
    }
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      return
    }
    setConfirmOpen(false)
    setReason('')
    toast.success(t('handout.rejectedToast', { barcode: row.barcode ?? '' }))
    refresh()
  }

  const tabs = [
    { key: 'details', label: t('detail.tabDetails') },
    { key: 'condition', label: t('parcelDetail.tabCondition') },
    { key: 'delivery', label: t('parcelDetail.tabDelivery') },
    { key: 'actions', label: t('detail.tabActions') },
  ]

  const value = (v: string | null | undefined) => v || '—'

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
            <Field label={t('parcels.barcode')}>
              <span className="font-mono text-[13px]">{value(row.barcode)}</span>
            </Field>
            <Field label={t('parcels.status')}>
              <div>
                <ParcelStatusBadge status={row.status} />
              </div>
            </Field>
            {/* Annulleret fejlregistrering: begrundelse + hvem/hvornår. */}
            {row.status === 'removed' && (
              <div className="flex flex-col gap-4 rounded-md border border-destructive/40 bg-destructive/5 p-4">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-destructive">
                  <Trash2 className="size-3.5" />
                  {t('removeParcel.removedBadge')}
                </span>
                <Field label={t('removeParcel.reason')}>
                  <span className="whitespace-pre-wrap text-[13px]">
                    {value(row.removed_reason)}
                  </span>
                </Field>
                <Field label={t('removeParcel.removedAt')}>
                  <span className="text-[13px]">
                    {row.removed_at ? dateFormat.format(new Date(row.removed_at)) : '—'}
                  </span>
                </Field>
                <Field label={t('removeParcel.removedBy')}>
                  <span className="text-[13px]">{removedBy ?? '—'}</span>
                </Field>
              </div>
            )}
            <Field
              label={
                row.receiver_override_reason ? t('override.intendedReceiver') : t('parcels.receiver')
              }
            >
              <span className="text-[13px]">{value(row.receiver?.full_name)}</span>
            </Field>
            {/* Manager-override: den faktiske modtager står lige under den
                tilsigtede, så begge navne læses i samme blik. */}
            {row.receiver_override_reason && (
              <Field label={t('override.actualReceiver')}>
                <span className="flex items-center gap-1.5 text-[13px]">
                  <ShieldAlert className="size-3.5 shrink-0 text-status-neutral" />
                  {value(row.delivered_employee?.full_name ?? row.delivered_to)}
                </span>
              </Field>
            )}
            <Field label={t('parcels.department')}>
              <span className="text-[13px]">{value(row.department?.name)}</span>
            </Field>
            <Field label={t('parcelDetail.sender')}>
              <span className="text-[13px]">{value(row.sender)}</span>
            </Field>
            <Field label={t('parcelDetail.type')}>
              <span className="text-[13px]">{typeLabel(row.parcel_type)}</span>
            </Field>
            <Field label={t('parcelDetail.private')}>
              <span className="text-[13px]">{row.is_private ? t('common.yes') : t('common.no')}</span>
            </Field>
            <Field label={t('receive.carrier')}>
              <span className="text-[13px]">{value(row.carrier?.name)}</span>
            </Field>
            <Field label={t('receive.handling')}>
              <span className="text-[13px]">{value(row.handling?.name)}</span>
            </Field>
            <Field label={t('parcels.location')}>
              <span className="text-[13px]">{value(row.location?.name)}</span>
            </Field>
            <Field label={t('parcels.registeredAt')}>
              <span className="text-[13px]">{dateFormat.format(new Date(row.registered_at))}</span>
            </Field>
          </div>
        )}
        {tab === 'condition' && (
          <ParcelConditionTab
            parcelId={row.id}
            conditionPreset={row.condition_preset}
            conditionNote={row.condition_note}
            conditionPhotoPath={row.condition_photo_path}
          />
        )}
        {tab === 'delivery' && (
          <div className="flex flex-col gap-5">
            <Field label={t('parcelDetail.deliveredTo')}>
              <span className="text-[13px]">{value(row.delivered_to)}</span>
            </Field>
            <Field label={t('parcelDetail.deliveredAt')}>
              <span className="text-[13px]">
                {row.delivered_at ? dateFormat.format(new Date(row.delivered_at)) : '—'}
              </span>
            </Field>
            <Field label={t('parcelDetail.deliveredNote')}>
              <span className="whitespace-pre-wrap text-[13px]">{value(row.delivered_note)}</span>
            </Field>
            {row.receiver_override_reason && (
              <div className="flex flex-col gap-4 rounded-md border border-status-neutral/40 bg-status-neutral/5 p-4">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-status-neutral-to-bad">
                  <ShieldAlert className="size-3.5" />
                  {t('override.badge')}
                </span>
                <Field label={t('override.intendedReceiver')}>
                  <span className="text-[13px]">{value(row.receiver?.full_name)}</span>
                </Field>
                <Field label={t('override.actualReceiver')}>
                  <span className="text-[13px]">
                    {value(row.delivered_employee?.full_name ?? row.delivered_to)}
                  </span>
                </Field>
                <Field label={t('override.reason')}>
                  <span className="whitespace-pre-wrap text-[13px]">
                    {row.receiver_override_reason}
                  </span>
                </Field>
                <Field label={t('override.at')}>
                  <span className="text-[13px]">
                    {row.receiver_override_at
                      ? dateFormat.format(new Date(row.receiver_override_at))
                      : '—'}
                  </span>
                </Field>
                <Field label={t('override.by')}>
                  <span className="text-[13px]">{overrideBy ?? '—'}</span>
                </Field>
              </div>
            )}
          </div>
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            {canHandover && (
              <div className="flex flex-col gap-3 rounded-md border p-4">
                <div>
                  <p className="text-[13px] font-[450]">{t('parcelDetail.handoverTitle')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('parcelDetail.handoverActionDescription')}
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" disabled={!companyId} onClick={() => setHandoverOpen(true)}>
                    {t('parcelDetail.handover')}
                  </Button>
                </div>
              </div>
            )}
            {canRelocate && (
              <div className="flex flex-col gap-3 rounded-md border p-4">
                <div>
                  <p className="text-[13px] font-[450]">{t('parcelDetail.relocateTitle')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('parcelDetail.relocateActionDescription')}
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!companyId}
                    onClick={() => setRelocateOpen(true)}
                  >
                    {t('parcelDetail.relocate')}
                  </Button>
                </div>
              </div>
            )}
            {/* Fejlregistrering: pakken findes ikke fysisk og kan hverken
                udleveres eller returneres — kun manager kan annullere den. */}
            {canRemove && (
              <div className="flex flex-col gap-3 rounded-md border border-destructive/40 p-4">
                <div>
                  <p className="text-[13px] font-[450] text-destructive">
                    {t('removeParcel.title')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('removeParcel.actionDescription')}
                  </p>
                </div>
                {canRemoveStatus ? (
                  <div className="flex justify-end">
                    <Button size="sm" variant="destructive" onClick={() => setRemoveOpen(true)}>
                      <Trash2 className="size-3.5" /> {t('removeParcel.action')}
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('removeParcel.notRemovable', { status: t(statusLabelKey[row.status]) })}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-col gap-3 rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('parcelDetail.rejectTitle')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('parcelDetail.rejectDescription')}
                </p>
              </div>
              {!canReject ? (
                <p className="text-xs text-muted-foreground">
                  {t('parcelDetail.notRejectable', { status: t(statusLabelKey[row.status]) })}
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="reject-reason" className="text-label">
                      {t('parcelDetail.rejectReason')}
                    </Label>
                    <Textarea
                      id="reject-reason"
                      value={reason}
                      rows={2}
                      placeholder={t('parcelDetail.rejectReasonPlaceholder')}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setConfirmOpen(true)}
                    >
                      {t('handout.reject')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </DetailTabs>

      <Dialog open={confirmOpen} onOpenChange={(open) => !busy && setConfirmOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">{t('parcelDetail.rejectTitle')}</DialogTitle>
            <DialogDescription>
              {t('parcelDetail.rejectConfirm', { barcode: row.barcode ?? row.id.slice(0, 8) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={reject} disabled={busy}>
              {busy ? t('common.loading') : t('handout.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {companyId && (
        <ParcelHandoverDialog
          open={handoverOpen}
          onOpenChange={setHandoverOpen}
          parcel={{
            id: row.id,
            barcode: row.barcode,
            receiverName: row.receiver?.full_name ?? null,
            allowProxy: row.handling?.allow_proxy_collection ?? true,
          }}
          companyId={companyId}
          onDone={refresh}
        />
      )}

      <ParcelRemoveDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        parcel={{ id: row.id, barcode: row.barcode }}
        onRemoved={() => {
          onClose()
          refresh()
        }}
      />

      {companyId && (
        <ParcelRelocateDialog
          open={relocateOpen}
          onOpenChange={setRelocateOpen}
          parcel={{
            id: row.id,
            barcode: row.barcode,
            status: row.status,
            locationId: row.storage_location_id,
          }}
          companyId={companyId}
          onDone={refresh}
        />
      )}
    </>
  )
}

function ParcelsPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useRows()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [receiveOpen, setReceiveOpen] = useState(false)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['parcels'] })
    queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<Row>[] = [
    {
      key: 'barcode',
      header: t('parcels.barcode'),
      sortable: true,
      sortValue: (r) => r.barcode,
      render: (r) => <span className="font-mono text-xs">{r.barcode ?? '—'}</span>,
    },
    {
      key: 'receiver',
      header: t('parcels.receiver'),
      sortable: true,
      sortValue: (r) => r.receiver?.full_name ?? null,
      // Ved manager-override vises både den tilsigtede og den faktiske modtager
      // i cellen — ellers ser listen ud som om den tilsigtede kvitterede.
      render: (r) =>
        r.receiver_override_reason ? (
          <span className="flex flex-col">
            <span>{r.receiver?.full_name ?? '—'}</span>
            <span className="flex items-center gap-1 text-[11px] text-status-neutral-to-bad">
              <ShieldAlert className="size-3" />→{' '}
              {r.delivered_employee?.full_name ?? r.delivered_to ?? '—'}
            </span>
          </span>
        ) : (
          (r.receiver?.full_name ?? '—')
        ),
    },
    {
      key: 'department',
      header: t('parcels.department'),
      sortable: true,
      sortValue: (r) => r.department?.name ?? null,
      render: (r) => r.department?.name ?? '—',
    },
    {
      key: 'status',
      header: t('parcels.status'),
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => <ParcelStatusBadge status={r.status} />,
    },
    {
      key: 'location',
      header: t('parcels.location'),
      sortable: true,
      sortValue: (r) => r.location?.name ?? null,
      render: (r) => r.location?.name ?? '—',
    },
    {
      key: 'registered_at',
      header: t('parcels.registeredAt'),
      sortable: true,
      sortValue: (r) => r.registered_at,
      render: (r) => dateFormat.format(new Date(r.registered_at)),
    },
  ]

  const activeRow = data?.find((row) => row.id === activeId) ?? null

  // Bevidst ingen onDelete: pakker må ikke slettes fra klienter
  // (ingen delete-policy/grant) — sporbarheden er hele produktet.
  return (
    <div className="flex min-h-full flex-col gap-6">
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('nav.parcels').toLowerCase()}
        searchText={(row) =>
          [row.barcode, row.receiver?.full_name, row.department?.name, row.location?.name]
            .filter(Boolean)
            .join(' ')
        }
        storageKey="parcels"
        toolbar={
          <Button
            size="sm"
            variant="outline"
            disabled={!companyId}
            onClick={() => setReceiveOpen(true)}
          >
            <PackagePlus className="size-4" /> {t('nav.receive')}
          </Button>
        }
        onRowClick={(row) => setActiveId((prev) => (prev === row.id ? null : row.id))}
        activeRowId={activeId}
      />
      {activeRow && (
        <ParcelDetailPane
          key={activeRow.id}
          row={activeRow}
          companyId={companyId}
          onClose={() => setActiveId(null)}
          refresh={refresh}
        />
      )}
      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('nav.receive')}</DialogTitle>
          </DialogHeader>
          {companyId && (
            <ParcelReceiveForm companyId={companyId} onReceived={() => setReceiveOpen(false)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

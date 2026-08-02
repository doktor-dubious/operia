import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ParcelRemoveDialog, useCanRemoveParcel } from '@/components/parcel-remove-dialog'
import { ParcelStatusBadge, type ParcelStatus } from '@/components/parcel-status-badge'
import { ParcelConditionBlock } from '@/components/parcel-condition'
import { moveTargets } from '@/lib/parcel-moves'

// Pakkens "visitkort": stregkode + status, nøgleoplysningerne og hurtig-
// handlinger. Delt af Søg-siden og pakkeoversigtens popup, så en pakke altid
// præsenteres ens uanset hvor man møder den.

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

export type ParcelSummaryData = {
  id: string
  barcode: string | null
  status: ParcelStatus
  receiverName: string | null
  departmentName: string | null
  locationName: string | null
  registeredAt: string
  deliveredTo: string | null
  sender?: string | null
  // Tilstand: intake-note/-foto. Dokumentposterne hentes af blokken selv.
  conditionNote?: string | null
  conditionPhotoPath?: string | null
  // Manager-override: pakken blev udleveret til en ANDEN end receiverName.
  // Begge navne vises, så kæden kan læses uden at grave i historikken.
  overrideReason?: string | null
  overrideAt?: string | null
  deliveredEmployeeName?: string | null
  // Annulleret fejlregistrering (status 'removed').
  removedReason?: string | null
  removedAt?: string | null
}

export function ParcelSummary({
  parcel,
  showActions = true,
  showCondition = true,
  onRemoved,
}: {
  parcel: ParcelSummaryData
  showActions?: boolean
  // Tilstandsblokken skjuler sig selv, hvis pakken ingen dokumentation har.
  showCondition?: boolean
  // Kaldes når pakken er annulleret, så en popup kan lukke sig selv.
  onRemoved?: () => void
}) {
  const { t } = useTranslation()
  const [removeOpen, setRemoveOpen] = useState(false)
  const canRemove = useCanRemoveParcel()
  // Afsluttede statusser (inkl. 'removed') har ingen åbne handlinger tilbage.
  const terminal =
    parcel.status === 'delivered' || parcel.status === 'returned' || parcel.status === 'removed'
  const canMove = moveTargets(parcel.status).length > 0
  const code = parcel.barcode ?? undefined

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm">{parcel.barcode ?? '—'}</span>
        <ParcelStatusBadge status={parcel.status} />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
        <dt className="text-muted-foreground">
          {parcel.overrideReason ? t('override.intendedReceiver') : t('parcels.receiver')}
        </dt>
        <dd>{parcel.receiverName ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('parcels.department')}</dt>
        <dd>{parcel.departmentName ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('parcels.sender')}</dt>
        <dd>{parcel.sender ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('parcels.location')}</dt>
        <dd>{parcel.locationName ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('parcels.registeredAt')}</dt>
        <dd>{dateFormat.format(new Date(parcel.registeredAt))}</dd>
        {parcel.deliveredTo && (
          <>
            <dt className="text-muted-foreground">{t('parcelDetail.deliveredTo')}</dt>
            <dd>{parcel.deliveredTo}</dd>
          </>
        )}
      </dl>

      {/* Manager-override: hvem fik pakken i stedet, og hvorfor. */}
      {parcel.overrideReason && (
        <div className="flex flex-col gap-1 rounded-md border border-status-neutral/40 bg-status-neutral/5 p-3">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-status-neutral-to-bad">
            <ShieldAlert className="size-3.5" />
            {t('override.badge')}
          </span>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">{t('override.actualReceiver')}</dt>
            <dd>{parcel.deliveredEmployeeName ?? parcel.deliveredTo ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('override.reason')}</dt>
            <dd className="whitespace-pre-wrap">{parcel.overrideReason}</dd>
            {parcel.overrideAt && (
              <>
                <dt className="text-muted-foreground">{t('override.at')}</dt>
                <dd>{dateFormat.format(new Date(parcel.overrideAt))}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {/* Annulleret fejlregistrering: hvorfor, og hvornår. */}
      {parcel.status === 'removed' && (
        <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-destructive">
            <Trash2 className="size-3.5" />
            {t('removeParcel.removedBadge')}
          </span>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">{t('removeParcel.reason')}</dt>
            <dd className="whitespace-pre-wrap">{parcel.removedReason ?? '—'}</dd>
            {parcel.removedAt && (
              <>
                <dt className="text-muted-foreground">{t('removeParcel.removedAt')}</dt>
                <dd>{dateFormat.format(new Date(parcel.removedAt))}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {showCondition && (
        <ParcelConditionBlock
          parcelId={parcel.id}
          conditionNote={parcel.conditionNote ?? null}
          conditionPhotoPath={parcel.conditionPhotoPath ?? null}
        />
      )}

      {/* Hurtig-handlinger: kun dem pakkens status tillader. */}
      {showActions && (
        <div className="flex flex-wrap gap-2">
          {!terminal && (
            <Button asChild size="sm" variant="outline">
              <Link to="/parcels/handout" search={{ code }}>
                {t('nav.handout')}
              </Link>
            </Button>
          )}
          {canMove && (
            <Button asChild size="sm" variant="outline">
              <Link to="/parcels/move" search={{ code }}>
                {t('nav.move')}
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link to="/parcels/condition" search={{ code }}>
              {t('nav.condition')}
            </Link>
          </Button>
          {/* Fjern fejlregistrering — kun manager, og kun så længe pakken er
              åben (en udleveret pakke er en sand hændelse). */}
          {canRemove && !terminal && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 className="size-3.5" /> {t('removeParcel.action')}
            </Button>
          )}
        </div>
      )}

      <ParcelRemoveDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        parcel={{ id: parcel.id, barcode: parcel.barcode }}
        onRemoved={onRemoved}
      />
    </div>
  )
}

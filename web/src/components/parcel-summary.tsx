import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
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
  // Tilstand: intake-note/-foto. Dokumentposterne hentes af blokken selv.
  conditionNote?: string | null
  conditionPhotoPath?: string | null
}

export function ParcelSummary({
  parcel,
  showActions = true,
  showCondition = true,
}: {
  parcel: ParcelSummaryData
  showActions?: boolean
  // Tilstandsblokken skjuler sig selv, hvis pakken ingen dokumentation har.
  showCondition?: boolean
}) {
  const { t } = useTranslation()
  const terminal = parcel.status === 'delivered' || parcel.status === 'returned'
  const canMove = moveTargets(parcel.status).length > 0
  const code = parcel.barcode ?? undefined

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm">{parcel.barcode ?? '—'}</span>
        <ParcelStatusBadge status={parcel.status} />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
        <dt className="text-muted-foreground">{t('parcels.receiver')}</dt>
        <dd>{parcel.receiverName ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('parcels.department')}</dt>
        <dd>{parcel.departmentName ?? '—'}</dd>
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
        </div>
      )}
    </div>
  )
}

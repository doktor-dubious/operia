import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Archive, FileX, Undo2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AssetStatusBadge } from '@/components/asset-status-badge'
import { AssetDocumentBlock } from '@/components/asset-condition'
import {
  AssetReinstateDialog,
  AssetRetireDialog,
  AssetServiceDialog,
  AssetWriteOffDialog,
  useCanManageAssets,
  useCanOperateAssets,
} from '@/components/asset-flow-dialogs'
import { useOpenLoan } from '@/hooks/use-open-loan'
import { retireReasonLabelKey, type RetireReason } from '@/lib/asset-board'
import { assetCode, type AssetHit } from '@/lib/asset-lookup'

// Aktivets "visitkort": tag/navn + status, nøgleoplysninger og hurtig-
// handlinger. Delt af Søg-siden, oversigtens popup og flow-siderne, så et
// aktiv altid præsenteres ens uanset hvor man møder det.

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })
const dayFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short' })

export function AssetSummary({
  asset,
  showActions = true,
  onChanged,
}: {
  asset: AssetHit
  showActions?: boolean
  // Kaldes efter service/udfas/genindsæt, så en popup kan genindlæse/lukke.
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const canOperate = useCanOperateAssets()
  const canManage = useCanManageAssets()
  const onLoan = asset.status === 'on_loan'
  const { data: loan } = useOpenLoan(asset.id, onLoan)
  const [serviceOpen, setServiceOpen] = useState(false)
  const [retireOpen, setRetireOpen] = useState(false)
  const [reinstateOpen, setReinstateOpen] = useState(false)
  const [writeOffOpen, setWriteOffOpen] = useState(false)

  const code = assetCode(asset)
  const canCheckout = asset.status === 'in_stock' && asset.is_active
  const canCheckin = ['assigned', 'on_loan', 'service'].includes(asset.status)
  const canMove = asset.status !== 'on_loan' && asset.status !== 'written_off'
  const canService = ['in_stock', 'assigned'].includes(asset.status) && asset.is_active
  // Afskrivning: aktivet er ude, og kravet kan opgives (manager-niveau).
  const canWriteOff = ['assigned', 'on_loan', 'service'].includes(asset.status)
  const overdue = onLoan && !!loan?.expires_at && new Date(loan.expires_at) < new Date()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[14px] font-medium">{asset.name}</span>
          {asset.asset_tag && (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {asset.asset_tag}
            </span>
          )}
        </div>
        <AssetStatusBadge status={asset.status} />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
        <dt className="text-muted-foreground">{t('assetsPage.category')}</dt>
        <dd>{asset.category?.name ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('assetsPage.location')}</dt>
        <dd>{asset.location?.name ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('assetsPage.serialNo')}</dt>
        <dd className="font-mono">{asset.serial_no ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('assetsPage.barcode')}</dt>
        <dd className="font-mono">{asset.barcode ?? '—'}</dd>
        {asset.condition && (
          <>
            <dt className="text-muted-foreground">{t('assetsPage.condition')}</dt>
            <dd>{asset.condition}</dd>
          </>
        )}
        {asset.assigned && (
          <>
            <dt className="text-muted-foreground">{t('assetFlow.assignedTo')}</dt>
            <dd>
              {asset.assigned.full_name}
              {asset.assigned_at && (
                <span className="text-muted-foreground">
                  {' '}
                  · {dateFormat.format(new Date(asset.assigned_at))}
                </span>
              )}
            </dd>
          </>
        )}
        {onLoan && loan && (
          <>
            <dt className="text-muted-foreground">{t('assetsPage.loanTo')}</dt>
            <dd>{loan.to_name}</dd>
            {loan.expires_at && (
              <>
                <dt className="text-muted-foreground">{t('assetsPage.loanExpires')}</dt>
                <dd className={overdue ? 'text-destructive' : undefined}>
                  {dateFormat.format(new Date(loan.expires_at))}
                  {overdue && <> · {t('assetFlow.overdue')}</>}
                </dd>
              </>
            )}
          </>
        )}
        {asset.status === 'service' && (
          <>
            <dt className="text-muted-foreground">{t('assetFlow.serviceVendor')}</dt>
            <dd>{asset.service_vendor ?? '—'}</dd>
            {asset.service_expected_back && (
              <>
                <dt className="text-muted-foreground">{t('assetFlow.serviceExpectedBack')}</dt>
                <dd>{dayFormat.format(new Date(asset.service_expected_back))}</dd>
              </>
            )}
          </>
        )}
        {asset.status === 'retired' && (
          <>
            <dt className="text-muted-foreground">{t('assetFlow.retireReason')}</dt>
            <dd>
              {asset.retired_reason
                ? t(
                    retireReasonLabelKey[asset.retired_reason as RetireReason] ??
                      'assetFlow.retireReasonOther',
                  )
                : '—'}
              {asset.retired_at && (
                <span className="text-muted-foreground">
                  {' '}
                  · {dateFormat.format(new Date(asset.retired_at))}
                </span>
              )}
            </dd>
          </>
        )}
        {asset.status === 'written_off' && asset.written_off_at && (
          <>
            <dt className="text-muted-foreground">{t('assetsPage.statusWrittenOff')}</dt>
            <dd>{dateFormat.format(new Date(asset.written_off_at))}</dd>
          </>
        )}
      </dl>

      <AssetDocumentBlock assetId={asset.id} />

      {/* Hurtig-handlinger: kun dem aktivets status tillader. */}
      {showActions && canOperate && (
        <div className="flex flex-wrap gap-2">
          {canCheckout && (
            <Button asChild size="sm" variant="outline">
              <Link to="/assets/checkout" search={{ code }}>
                {t('nav.assetCheckout')}
              </Link>
            </Button>
          )}
          {canCheckin && (
            <Button asChild size="sm" variant="outline">
              <Link to="/assets/checkin" search={{ code }}>
                {t('nav.assetCheckin')}
              </Link>
            </Button>
          )}
          {canMove && (
            <Button asChild size="sm" variant="outline">
              <Link to="/assets/move" search={{ code }}>
                {t('nav.assetMove')}
              </Link>
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link to="/assets/document" search={{ code }}>
              {t('nav.assetDocument')}
            </Link>
          </Button>
          {canService && (
            <Button size="sm" variant="outline" onClick={() => setServiceOpen(true)}>
              <Wrench className="size-3.5" /> {t('assetFlow.serviceSend')}
            </Button>
          )}
          {canManage && canWriteOff && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setWriteOffOpen(true)}
            >
              <FileX className="size-3.5" /> {t('assetFlow.writeOff')}
            </Button>
          )}
          {canManage &&
            asset.status !== 'retired' &&
            asset.status !== 'written_off' &&
            asset.status !== 'on_loan' && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setRetireOpen(true)}
              >
                <Archive className="size-3.5" /> {t('assetFlow.retire')}
              </Button>
            )}
          {canManage && (asset.status === 'retired' || asset.status === 'written_off') && (
            <Button size="sm" variant="outline" onClick={() => setReinstateOpen(true)}>
              <Undo2 className="size-3.5" /> {t('assetFlow.reinstate')}
            </Button>
          )}
        </div>
      )}

      <AssetServiceDialog
        open={serviceOpen}
        onOpenChange={setServiceOpen}
        asset={asset}
        onDone={onChanged}
      />
      <AssetRetireDialog
        open={retireOpen}
        onOpenChange={setRetireOpen}
        asset={asset}
        onDone={onChanged}
      />
      <AssetReinstateDialog
        open={reinstateOpen}
        onOpenChange={setReinstateOpen}
        asset={asset}
        onDone={onChanged}
      />
      <AssetWriteOffDialog
        open={writeOffOpen}
        onOpenChange={setWriteOffOpen}
        asset={asset}
        onDone={onChanged}
      />
    </div>
  )
}

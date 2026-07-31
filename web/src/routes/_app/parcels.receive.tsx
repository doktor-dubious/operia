import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Layers, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCompany } from '@/components/company-provider'
import { printBatchLabel, printLabel } from '@/components/label-designer'
import { ParcelStatusBadge } from '@/components/parcel-status-badge'
import {
  ParcelReceiveForm,
  type BatchSessionEntry,
  type ParcelSessionEntry,
} from '@/components/parcel-receive-form'
import { useCompanyContext } from '@/hooks/use-company-context'
import { useBatchLabelDesign, useParcelLabelDesign } from '@/hooks/use-label-design'

export const Route = createFileRoute('/_app/parcels/receive')({
  component: ReceivePage,
})

function ReceivePage() {
  const { t, i18n } = useTranslation()
  const { companyId, isPending: companyPending } = useCompanyContext()
  const { activeCompany } = useCompany()
  const { data: labelDesign } = useParcelLabelDesign(companyId)
  const { data: batchLabelDesign } = useBatchLabelDesign(companyId)
  const [sessionList, setSessionList] = useState<ParcelSessionEntry[]>([])
  const [batchList, setBatchList] = useState<BatchSessionEntry[]>([])

  // Print/genprint batch-labelen (kun web) — stregkode/QR = batch-koden.
  const printEntryBatchLabel = (entry: BatchSessionEntry) => {
    if (!batchLabelDesign) return
    printBatchLabel(batchLabelDesign, i18n.language, activeCompany?.name, {
      batchCode: entry.batchCode,
      batchCount: entry.count,
      recipientName: entry.receiver,
      department: entry.department,
      date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short' }).format(new Date()),
    })
  }

  // Genprint af en netop modtaget pakkes label — fx hvis den første print
  // mislykkedes, eller pakkens egen kode viste sig ulæselig.
  const printEntryLabel = (entry: ParcelSessionEntry) => {
    if (!labelDesign) return
    printLabel(labelDesign, i18n.language, activeCompany?.name, {
      code: entry.barcode,
      reference: entry.barcode,
      recipientName: entry.receiver,
      department: entry.department,
      carrier: entry.carrier,
      date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short' }).format(new Date()),
    })
  }

  if (companyPending) return <Skeleton className="h-40 w-full max-w-2xl" />

  if (!companyId) {
    return <p className="text-sm text-muted-foreground">{t('receive.noCompany')}</p>
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <Card className="w-full max-w-2xl bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('nav.receive')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ParcelReceiveForm
            companyId={companyId}
            onReceived={(entry) => setSessionList((list) => [entry, ...list])}
            onBatchFinished={(entry) => setBatchList((list) => [entry, ...list])}
          />
        </CardContent>
      </Card>

      <div className="flex w-full max-w-md flex-col gap-6 self-start">
        {batchList.length > 0 && (
          <Card className="bg-panel">
            <CardHeader>
              <CardTitle className="text-base">{t('receive.batchListTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y divide-border">
                {batchList.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">{entry.batchCode}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t('receive.batchListCount', { count: entry.count })}
                        {entry.receiver ? ` · ${entry.receiver}` : ''}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-xs"
                      disabled={!batchLabelDesign}
                      onClick={() => printEntryBatchLabel(entry)}
                    >
                      <Layers className="size-3.5" />
                      {t('receive.printBatchLabel')}
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

      <Card className="bg-panel">
        <CardHeader>
          <CardTitle className="text-base">{t('receive.sessionList')}</CardTitle>
        </CardHeader>
        <CardContent>
          {sessionList.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('receive.sessionEmpty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {sessionList.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs">{entry.barcode}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.receiver ?? t('dashboard.statusUnassigned')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <ParcelStatusBadge status={entry.status} />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      aria-label={t('receive.printLabel')}
                      title={t('receive.printLabel')}
                      disabled={!labelDesign}
                      onClick={() => printEntryLabel(entry)}
                    >
                      <Printer className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ParcelStatusBadge } from '@/components/parcel-status-badge'
import { ParcelReceiveForm, type ParcelSessionEntry } from '@/components/parcel-receive-form'
import { useCompanyContext } from '@/hooks/use-company-context'

export const Route = createFileRoute('/_app/parcels/receive')({
  component: ReceivePage,
})

function ReceivePage() {
  const { t } = useTranslation()
  const { companyId, isPending: companyPending } = useCompanyContext()
  const [sessionList, setSessionList] = useState<ParcelSessionEntry[]>([])

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
          />
        </CardContent>
      </Card>

      <Card className="w-full max-w-md self-start bg-panel">
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
                  <ParcelStatusBadge status={entry.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
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
import { Download } from 'lucide-react'
import {
  BookingHistoryTable,
  useBookingHistory,
  useHistoryLookups,
} from '@/components/booking-history-view'
import { BookingHistoryExportDialog } from '@/components/booking-history-export-dialog'
import { useCompanyContext } from '@/hooks/use-company-context'
import { actorLabel, emptyLookups, type HistoryRow } from '@/lib/booking-history'

// Booking → Historik (EVU-krav D-05): den samlede ændringslog for bookinger,
// med de tre filtre kravet nævner — periode, booking og bruger.
//
// "Booking" som filter er en FRITEKSTSØGNING og ikke en id-vælger: den, der
// leder efter en booking, husker lokalet og formålet, ikke et UUID. Søgningen
// rammer også id'et, så et opslag fra en eksportfil eller en e-mail virker.
//
// Siden er manager-niveau som resten af bookingens stamdata: historikken
// rummer medarbejdernavne og ændringer i fakturagrundlaget.
export const Route = createFileRoute('/_app/booking/history')({
  component: HistoryPage,
})

const ALL_USERS = 'all'

function HistoryPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [actor, setActor] = useState(ALL_USERS)
  const [exportOpen, setExportOpen] = useState(false)
  // Rækkerne tabellen VISER efter søgning og kolonnefiltre — det er dem
  // eksporten skal indeholde (D-06: "de filtrerede poster").
  const [visible, setVisible] = useState<HistoryRow[]>([])

  const { data: lookups } = useHistoryLookups(companyId)
  const { data, isPending } = useBookingHistory({
    companyId,
    from: from || undefined,
    to: to || undefined,
    actorUserId: actor === ALL_USERS ? undefined : actor,
  })

  if (!companyId) return <Skeleton className="h-40 w-full" />

  // Aktørlisten rummer også DCA's platform-admins, så en manager kan filtrere
  // på "hvad har leverandøren rørt" — de står som organisationen, ikke som
  // personer.
  const users = [...(lookups?.users ?? new Map()).keys()]
    .map((id) => [id, actorLabel(id, lookups ?? emptyLookups(), t)] as const)
    .sort((a, b) => a[1].localeCompare(b[1], 'da'))
  const filtered = !!from || !!to || actor !== ALL_USERS

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="hist-from" className="text-label">
            {t('bookingHistory.fromDate')}
          </Label>
          <Input
            id="hist-from"
            type="date"
            className="w-44"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="hist-to" className="text-label">
            {t('bookingHistory.toDate')}
          </Label>
          <Input
            id="hist-to"
            type="date"
            className="w-44"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('bookingHistory.actor')}</Label>
          <Select value={actor} onValueChange={setActor}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_USERS}>{t('bookingHistory.allUsers')}</SelectItem>
              {users.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            className="mb-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setFrom('')
              setTo('')
              setActor(ALL_USERS)
            }}
          >
            {t('bookingHistory.clearFilters')}
          </Button>
        )}
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <BookingHistoryTable
          rows={data ?? []}
          lookups={lookups ?? emptyLookups()}
          companyId={companyId}
          storageKey="booking-history"
          onVisibleRowsChange={(r) => setVisible(r.filtered)}
          toolbar={
            <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
              <Download className="size-4" /> {t('bookingExport.export')}
            </Button>
          }
        />
      )}

      <BookingHistoryExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        companyId={companyId}
        rows={visible}
        lookups={lookups ?? emptyLookups()}
        filters={{
          from: from || undefined,
          to: to || undefined,
          actor: actor === ALL_USERS ? undefined : actorLabel(actor, lookups ?? emptyLookups(), t),
        }}
      />
    </div>
  )
}

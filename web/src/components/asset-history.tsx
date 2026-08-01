import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftToLine,
  ArrowRightFromLine,
  Camera,
  CircleDot,
  FileX,
  Handshake,
  MapPin,
  Plus,
  Undo2,
  UserRound,
  Wrench,
  Archive,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { statusLabelKey, type AssetStatus } from '@/components/asset-status-badge'
import { retireReasonLabelKey, type RetireReason } from '@/lib/asset-board'
import { supabase } from '@/lib/supabase'

// Aktivets hændelseshistorik (asset_events) som tidslinje — chain of custody
// gjort læsbar: hvem gjorde hvad, hvornår, fra/til hvilken status og placering.
// Placeringer og medarbejdere står som id'er i loggen (bevidst uden FK'er, og
// aldrig persondata i detail); navnene slås op ved visning, så anonymisering
// og omdøbning altid slår igennem.

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

const EVENT_ICON: Record<string, LucideIcon> = {
  created: Plus,
  status_changed: CircleDot,
  moved: MapPin,
  assigned_changed: UserRound,
  checked_out: ArrowRightFromLine,
  checked_in: ArrowLeftToLine,
  loaned: Handshake,
  service_sent: Wrench,
  retired: Archive,
  written_off: FileX,
  reinstated: Undo2,
  documented: Camera,
}

const EVENT_LABEL_KEY: Record<string, string> = {
  created: 'assetEvents.created',
  status_changed: 'assetEvents.statusChanged',
  moved: 'assetEvents.moved',
  assigned_changed: 'assetEvents.assignedChanged',
  checked_out: 'assetEvents.checkedOut',
  checked_in: 'assetEvents.checkedIn',
  loaned: 'assetEvents.loaned',
  service_sent: 'assetEvents.serviceSent',
  retired: 'assetEvents.retired',
  written_off: 'assetEvents.writtenOff',
  reinstated: 'assetEvents.reinstated',
  documented: 'assetEvents.documented',
}

type EventRow = {
  id: number
  event_type: string
  from_status: AssetStatus | null
  to_status: AssetStatus | null
  from_location_id: string | null
  to_location_id: string | null
  actor_user_id: string | null
  detail: Record<string, unknown>
  created_at: string
}

function useAssetEvents(assetId: string) {
  return useQuery({
    queryKey: ['asset-events', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_events')
        .select(
          'id, event_type, from_status, to_status, from_location_id, to_location_id, actor_user_id, detail, created_at',
        )
        .eq('asset_id', assetId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(200)
      if (error) throw error
      const events = (data ?? []) as unknown as EventRow[]

      // Navneopslag: placeringer, medarbejdere (fra detail) og aktører.
      const locationIds = new Set<string>()
      const employeeIds = new Set<string>()
      const actorIds = new Set<string>()
      for (const e of events) {
        if (e.from_location_id) locationIds.add(e.from_location_id)
        if (e.to_location_id) locationIds.add(e.to_location_id)
        for (const key of ['employee_id', 'from_employee', 'to_employee']) {
          const v = e.detail?.[key]
          if (typeof v === 'string' && v) employeeIds.add(v)
        }
        if (e.actor_user_id) actorIds.add(e.actor_user_id)
      }
      const [locations, employees, actors] = await Promise.all([
        locationIds.size
          ? supabase.from('asset_locations').select('id, name').in('id', [...locationIds])
          : Promise.resolve({ data: [], error: null }),
        employeeIds.size
          ? supabase.from('employees').select('id, full_name').in('id', [...employeeIds])
          : Promise.resolve({ data: [], error: null }),
        actorIds.size
          ? supabase.from('app_users').select('user_id, full_name').in('user_id', [...actorIds])
          : Promise.resolve({ data: [], error: null }),
      ])
      const locationName = new Map((locations.data ?? []).map((l) => [l.id, l.name]))
      const employeeName = new Map((employees.data ?? []).map((e) => [e.id, e.full_name]))
      const actorName = new Map((actors.data ?? []).map((a) => [a.user_id, a.full_name]))
      return { events, locationName, employeeName, actorName }
    },
  })
}

export function AssetHistory({ assetId }: { assetId: string }) {
  const { t } = useTranslation()
  const { data, isPending } = useAssetEvents(assetId)

  if (isPending) return <Skeleton className="h-24 w-full" />
  if (!data?.events.length) {
    return <p className="text-xs text-muted-foreground">{t('assetFlow.noHistory')}</p>
  }

  const statusText = (s: AssetStatus | null) => (s ? t(statusLabelKey[s]) : null)

  return (
    <ol className="flex flex-col">
      {data.events.map((e, i) => {
        const Icon = EVENT_ICON[e.event_type] ?? CircleDot
        const detail = e.detail ?? {}
        const employee =
          (typeof detail.employee_id === 'string' && data.employeeName.get(detail.employee_id)) ||
          (typeof detail.to_employee === 'string' && data.employeeName.get(detail.to_employee)) ||
          (typeof detail.from_employee === 'string' &&
            data.employeeName.get(detail.from_employee)) ||
          null
        const actor = e.actor_user_id ? (data.actorName.get(e.actor_user_id) ?? null) : null
        const fromLoc = e.from_location_id
          ? (data.locationName.get(e.from_location_id) ?? null)
          : null
        const toLoc = e.to_location_id ? (data.locationName.get(e.to_location_id) ?? null) : null
        const statusChanged = e.from_status !== e.to_status && (e.from_status || e.to_status)
        const locationChanged = e.from_location_id !== e.to_location_id && (fromLoc || toLoc)
        const reason =
          e.event_type === 'retired' && typeof detail.reason === 'string'
            ? t(
                retireReasonLabelKey[detail.reason as RetireReason] ??
                  'assetFlow.retireReasonOther',
              )
            : null

        return (
          <li key={e.id} className="flex gap-3">
            {/* Tidslinjens streg + prik */}
            <div className="flex flex-col items-center">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background">
                <Icon className="size-3.5 text-muted-foreground" />
              </span>
              {i < data.events.length - 1 && <span className="w-px flex-1 bg-border" />}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pb-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium">
                  {t(EVENT_LABEL_KEY[e.event_type] ?? '', { defaultValue: e.event_type })}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {dateFormat.format(new Date(e.created_at))}
                </span>
              </div>
              <div className="flex flex-col text-xs text-muted-foreground">
                {statusChanged && (
                  <span>
                    {statusText(e.from_status) ?? '—'} → {statusText(e.to_status) ?? '—'}
                  </span>
                )}
                {locationChanged && (
                  <span>
                    {t('assetFlow.historyLocation')}: {fromLoc ?? '—'} → {toLoc ?? '—'}
                  </span>
                )}
                {employee && (
                  <span>
                    {t('assetFlow.historyEmployee')}: {employee}
                  </span>
                )}
                {reason && (
                  <span>
                    {t('assetFlow.retireReason')}: {reason}
                  </span>
                )}
                {actor && (
                  <span>
                    {t('assetFlow.historyActor')}: {actor}
                  </span>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

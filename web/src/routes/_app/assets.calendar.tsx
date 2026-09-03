import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AssetCalendar } from '@/components/asset-calendar'
import { TaskPageColumn } from '@/components/task-page-column'
import { mergeCalendarSearch, validateCalendarSearch } from '@/lib/calendar'

// Aktivkalenderen. Visning + dato lever i URL'en; selve tilstandshåndteringen
// deles med bookingkalenderen (lib/calendar.ts). Filtrene er lokal
// arbejdstilstand i komponenten.

export const Route = createFileRoute('/_app/assets/calendar')({
  validateSearch: validateCalendarSearch,
  component: CalendarPage,
})

function CalendarPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const view = search.view ?? 'week'

  return (
    <TaskPageColumn>
      <AssetCalendar
        view={view}
        dateISO={search.date}
        fromISO={search.from}
        toISO={search.to}
        onNavigate={(next) =>
          navigate({ search: mergeCalendarSearch(view, next), replace: true })
        }
      />
    </TaskPageColumn>
  )
}

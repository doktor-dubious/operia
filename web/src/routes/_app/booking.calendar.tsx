import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { BookingCalendar } from '@/components/booking-calendar'
import { TaskPageColumn } from '@/components/task-page-column'
import { mergeBookingSearch, validateBookingCalendarSearch } from '@/lib/booking-view'

// Bookingsiden. Visning, periode, dato OG filtre lever i URL'en, så en
// indsnævret tidslinje kan deles og overleve en genindlæsning; selve
// sammenfletningen (og oprydningen i standardværdier) bor i lib/booking-view.

export const Route = createFileRoute('/_app/booking/calendar')({
  validateSearch: validateBookingCalendarSearch,
  component: CalendarPage,
})

function CalendarPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  return (
    <TaskPageColumn>
      <BookingCalendar
        search={search}
        onChange={(next) => navigate({ search: mergeBookingSearch(next), replace: true })}
      />
    </TaskPageColumn>
  )
}

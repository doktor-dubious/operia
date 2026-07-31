-- Tillad overgangen registered → returned.
--
-- Baggrund: "Afvis pakke" ved udlevering betyder nu, at pakken sendes retur til
-- afsender med det samme — dvs. den skal ende i 'returned', ikke længere hvile i
-- 'rejected'. En netop modtaget, matchet pakke står i 'registered', og
-- state-maskinen forbød hidtil registered → returned (kun registered → rejected).
-- Uden denne overgang ville en afvisning af en 'registered'-pakke blive afvist af
-- parcels_guard-triggeren med en uforståelig fejl for handleren.
--
-- Resten af state-maskinen er uændret: 'rejected' beholdes som gyldig status for
-- historiske pakker (og rejected → returned/in_storage består), men app'en
-- producerer den ikke længere fra udleveringsflowet.

create or replace function public.parcel_transition_allowed(
  from_s public.parcel_status,
  to_s public.parcel_status
)
returns boolean
language sql
immutable
as $$
  select case from_s
    when 'unassigned' then to_s in ('registered', 'in_storage', 'returned')
    when 'registered' then to_s in ('in_storage', 'in_transit', 'in_locker', 'delivered', 'rejected', 'returned')
    when 'in_storage' then to_s in ('in_transit', 'in_locker', 'delivered', 'rejected', 'returned')
    when 'in_transit' then to_s in ('in_storage', 'in_locker', 'delivered', 'rejected', 'returned')
    when 'in_locker'  then to_s in ('delivered', 'returned', 'in_storage')
    when 'rejected'   then to_s in ('returned', 'in_storage')
    else false -- delivered og returned er terminale
  end;
$$;

-- Afsender ved modtagelse (spec Flow 1: "valgfri afsender"): kolonnen
-- parcels.sender har eksisteret fra start og vises i overblik + rapporter,
-- men ingen af modtag-formularerne har kunnet udfylde den. Felterne kommer nu
-- på web + håndterminal, og denne funktion leverer autocomplete-forslagene:
-- virksomhedens egne tidligere afsendere, hyppigst brugte først. Afsender er
-- bevidst fri tekst uden stamdata-tabel — leverandørnavne kommer og går, og
-- ingen ekstern kilde findes.
--
-- SECURITY INVOKER (default): RLS på parcels afgør, hvad kalderen kan se, så
-- funktionen kan ikke bruges til at læse afsendere på tværs af virksomheder.
create or replace function public.parcel_sender_suggestions(p_company_id uuid)
returns setof text
language sql
stable
as $$
  select sender
  from public.parcels
  where company_id = p_company_id and sender is not null
  group by sender
  order by count(*) desc, max(registered_at) desc
  limit 25;
$$;

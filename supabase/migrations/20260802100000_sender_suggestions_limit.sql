-- Afsender-feltet er nu en rigtig combobox (dropdown + fri indtastning) på
-- webben. Grænsen på 25 forslag betød, at en sjældent brugt afsender (fx et
-- nyt "TDC" med én pakke) kunne blive skubbet ud af listen af de 25 hyppigste
-- — stik imod løftet om "gemt til fremtidig brug". 100 dækker rigeligt;
-- klienten filtrerer alligevel, mens der skrives.
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
  limit 100;
$$;

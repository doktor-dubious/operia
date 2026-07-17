-- Genopret fragtfirma-valideringen i parcels_guard.
--
-- 20260717180000 genskabte funktionen ud fra den OPRINDELIGE version fra
-- 20260710031953 og tabte dermed tenant-tjekket på carrier_id, som
-- 20260710090929 havde tilføjet — en pakke kunne altså kobles til et andet
-- firmas fragtfirma uden fejl. Her er den fulde funktion igen: rydning af
-- placering ved delivered/returned (fra 180000) OG alle fem tenant-tjek.
--
-- Lærestreg for fremtidige ændringer: «create or replace» af parcels_guard
-- skal altid tage udgangspunkt i den SENESTE version i migrationshistorikken,
-- ikke den første.

create or replace function public.parcels_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Uden matchet modtager starter pakken som 'unassigned' (spec Flow 1).
    if new.receiver_employee_id is null and new.status not in ('unassigned') then
      new.status := 'unassigned';
    end if;
    if new.receiver_employee_id is not null and new.status = 'unassigned' then
      new.status := 'registered';
    end if;
  elsif new.status is distinct from old.status then
    if not public.parcel_transition_allowed(old.status, new.status) then
      raise exception 'Ugyldig statusovergang: % -> %', old.status, new.status;
    end if;
    if new.status = 'delivered' and new.delivered_at is null then
      new.delivered_at := now();
    end if;
    -- Pakken har forladt huset ⇒ den står ikke længere nogen steder.
    -- Bemærk: 'rejected' er med vilje IKKE med — se 20260717180000.
    if new.status in ('delivered', 'returned') then
      new.storage_location_id := null;
    end if;
  end if;

  -- FK-opslag omgår RLS, så tenant-tilhør valideres eksplicit her.
  if new.receiver_employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = new.receiver_employee_id and e.company_id = new.company_id
  ) then
    raise exception 'Modtager tilhører ikke virksomheden';
  end if;
  if new.department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = new.department_id and d.company_id = new.company_id
  ) then
    raise exception 'Afdeling tilhører ikke virksomheden';
  end if;
  if new.storage_location_id is not null and not exists (
    select 1 from public.storage_locations sl
    where sl.id = new.storage_location_id and sl.company_id = new.company_id
  ) then
    raise exception 'Placering tilhører ikke virksomheden';
  end if;
  if new.handling_class_id is not null and not exists (
    select 1 from public.handling_classes hc
    where hc.id = new.handling_class_id and hc.company_id = new.company_id
  ) then
    raise exception 'Håndteringsklasse tilhører ikke virksomheden';
  end if;
  if new.carrier_id is not null and not exists (
    select 1 from public.carriers c
    where c.id = new.carrier_id and c.company_id = new.company_id
  ) then
    raise exception 'Fragtfirma tilhører ikke virksomheden';
  end if;

  return new;
end;
$$;

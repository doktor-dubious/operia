-- Intern stregkode når der ikke scannes én (spec Flow 1's uafklarede punkt:
-- "ulæselige stregkoder"). Uden en stregkode er pakken usynlig for ALLE
-- scan-flows (Udlevér/Flyt/Tilstand/Søg slår op på barcode), så den kan kun
-- håndteres fra tabellen. Vi genererer derfor en intern kode, der kan skrives
-- på/printes som label — så er hver pakke findbar.
--
-- Genereringen ligger i parcels_guard (BEFORE INSERT) og ikke i klienten: så
-- gælder invarianten uanset indgang (web, håndterminal, senere import), og en
-- klient kan ikke omgå den.

-- Kode: 'OPR-' + 8 tegn fra et utvetydigt alfabet (uden 0/O/1/I), så den kan
-- læses op og indtastes i hånden uden forveksling. ~1,1e12 kombinationer;
-- løkken sikrer alligevel unikhed inden for virksomheden.
create or replace function public.generate_parcel_barcode(p_company_id uuid)
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
  i int;
begin
  loop
    candidate := 'OPR-';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.parcels
      where company_id = p_company_id and barcode = candidate
    );
  end loop;
  return candidate;
end;
$$;

-- parcels_guard genskabes med samme logik som før + stregkode-genereringen.
create or replace function public.parcels_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Tom/blank stregkode behandles som ingen stregkode.
    new.barcode := nullif(btrim(coalesce(new.barcode, '')), '');
    if new.barcode is null then
      new.barcode := public.generate_parcel_barcode(new.company_id);
    end if;

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

-- Efterfyld de eksisterende pakker uden stregkode, så invarianten gælder for
-- hele bestanden (ellers forbliver de usynlige for scan-flowsene).
-- Statusløs UPDATE ⇒ log_parcel_event skriver ingen hændelse.
update public.parcels
set barcode = public.generate_parcel_barcode(company_id)
where nullif(btrim(coalesce(barcode, '')), '') is null;

-- Placering på pakker der har forladt huset.
--
-- Problem: storage_location_id blev aldrig ryddet. En pakke, der havde stået på
-- en hylde og siden blev udleveret eller returneret, blev ved med at pege på
-- hylden — så pakkelisten viste en placering, pakken ikke stod på.
--
-- Regel (fysisk, ikke teknisk):
--   delivered → modtageren har pakken      ⇒ ryd placeringen
--   returned  → sendt retur til afsender   ⇒ ryd placeringen
--   rejected  → står STADIG fysisk i huset ⇒ BEHOLD placeringen
--               (rejected → returned/in_storage: handleren skal kunne finde den)
--
-- Historikken går ikke tabt: parcel_events er append-only og gemmer allerede
-- from_location_id/to_location_id på hver hændelse. Rydningen sker i
-- parcels_guard (BEFORE), så status_changed-hændelsen selv registrerer
-- from_location = hylden → to_location = null. Placeringen bevares altså i
-- kæden — den forsvinder kun fra "hvor er pakken nu".
--
-- Håndhævet i triggeren og ikke i klienterne, så web, håndterminal og en
-- kommende SFTP-pipeline opfører sig ens.

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
    -- Bemærk: 'rejected' er med vilje IKKE med — se hovedkommentaren.
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

  return new;
end;
$$;

-- Hændelseslogning: den automatiske rydning ovenfor er IKKE en flytning.
-- status_changed-hændelsen bærer allerede from_location → null; uden denne
-- undtagelse ville historikken oven i købet vise en "flyttet"-linje til
-- ingenting, som intet menneske har foretaget. Ellers uændret.
create or replace function public.log_parcel_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.parcel_events
      (parcel_id, company_id, event_type, to_status, to_location_id, actor_user_id, detail)
    values
      (new.id, new.company_id, 'created', new.status, new.storage_location_id, auth.uid(),
       jsonb_build_object('barcode', new.barcode));
  else
    if new.status is distinct from old.status then
      insert into public.parcel_events
        (parcel_id, company_id, event_type, from_status, to_status,
         from_location_id, to_location_id, actor_user_id)
      values
        (new.id, new.company_id, 'status_changed', old.status, new.status,
         old.storage_location_id, new.storage_location_id, auth.uid());
    end if;
    if new.storage_location_id is distinct from old.storage_location_id
       and not (
         new.status is distinct from old.status
         and new.status in ('delivered', 'returned')
         and new.storage_location_id is null
       )
    then
      insert into public.parcel_events
        (parcel_id, company_id, event_type, from_status, to_status,
         from_location_id, to_location_id, actor_user_id)
      values
        (new.id, new.company_id, 'moved', old.status, new.status,
         old.storage_location_id, new.storage_location_id, auth.uid());
    end if;
    if new.receiver_employee_id is distinct from old.receiver_employee_id then
      insert into public.parcel_events
        (parcel_id, company_id, event_type, from_status, to_status, actor_user_id, detail)
      values
        (new.id, new.company_id, 'receiver_assigned', old.status, new.status, auth.uid(),
         jsonb_build_object(
           'from_receiver', old.receiver_employee_id,
           'to_receiver', new.receiver_employee_id
         ));
    end if;
  end if;
  return new;
end;
$$;

-- Bagudrettet oprydning af rækker født under den gamle adfærd. Dette er en
-- datakorrektion — ikke en hændelse i pakkens liv — så hændelsesloggen slås fra
-- under netop denne UPDATE. Ellers ville hver ryddet række få en falsk
-- "flyttet"-linje i sin historik, dateret i dag, som ingen har foretaget.
-- (Selve parcel_events røres ikke; append-only-garantien står ved magt.)
alter table public.parcels disable trigger parcels_log_event;
update public.parcels
  set storage_location_id = null
  where status in ('delivered', 'returned')
    and storage_location_id is not null;
alter table public.parcels enable trigger parcels_log_event;

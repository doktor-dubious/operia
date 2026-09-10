-- Kursister på bookingen (EVU-krav A-05): antal og niveau.
--
-- Kravet er to felter, men det ene af dem er ikke et felt: "kursistniveau" er
-- en NØGLE, ikke en tekst. Krav C-07 siger, at fakturagrundlaget skal
-- differentieres på niveauet ("takst pr. niveau"), og en takst slået op på fri
-- tekst går i stykker første gang nogen skriver "niveau 2" med lille n. Derfor
-- får niveauerne en tabel pr. kunde, og bookingen en fremmednøgle.
--
-- Listens indhold er stadig et ÅBENT SPØRGSMÅL til kunden (spørgsmål 6 i
-- docs/evu-booking-kravstatus.md: fast liste eller vedligeholdt af kunden?).
-- En tabel er det rigtige svar uanset hvad de svarer — den kan seedes med en
-- fast liste eller passes af kunden — mens fri tekst ikke er rigtigt under
-- noget svar. Tabellen foregriber altså ikke afklaringen; den venter bare ikke
-- på den.
--
-- Vedligeholdes på Konfigurér → Booking, ikke som en fjerde stamdataside under
-- Booking. Niveauerne er prisopsætning (de bærer taksten i C-07), ikke noget
-- man rører i det daglige bookingarbejde, og de hører derfor sammen med
-- virksomhedens øvrige bookingindstillinger. Konsekvensen er, at en
-- booking_manager der IKKE også er manager kan bruge niveauerne men ikke
-- redigere listen; databasen tillader begge (can_manage_bookings), så det er
-- UI'et der er det smalleste led — den sikre vej rundt.
--
-- Sletning er `restrict`, ikke `set null`: et niveau er en del af
-- fakturagrundlaget, og en slettet række må ikke stille og roligt tømme feltet
-- på gamle bookinger. Et niveau der ikke længere udbydes deaktiveres i stedet.

-- ---------------------------------------------------------------------------
-- 1. Niveaulisten pr. kunde
-- ---------------------------------------------------------------------------
create table public.booking_participant_levels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  -- Rækkefølgen i editoren. Niveauer sorterer sjældent alfabetisk
  -- ("Grundniveau" før "Avanceret"), så listens egen orden er den rigtige.
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name),
  constraint booking_participant_levels_name_sane
    check (char_length(btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]')
);

create index booking_participant_levels_company_idx
  on public.booking_participant_levels (company_id, sort_order, name);

alter table public.booking_participant_levels enable row level security;

create policy booking_participant_levels_select on public.booking_participant_levels
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy booking_participant_levels_write on public.booking_participant_levels
  for all to authenticated
  using (public.can_manage_bookings(company_id))
  with check (public.can_manage_bookings(company_id));

grant select, insert, update, delete on public.booking_participant_levels to authenticated;

-- Revisionslog som de øvrige booking-stamdata.
create or replace function public.audit_booking_participant_levels()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'booking_level.created', 'booking_level',
      new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'booking_level.deactivated', 'booking_level',
        new.id::text, new.name);
    elsif old.name is distinct from new.name then
      perform public.record_audit(new.company_id, 'booking_level.renamed', 'booking_level',
        new.id::text, new.name, jsonb_build_object('from_name', old.name, 'to_name', new.name));
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'booking_level.deleted', 'booking_level',
      old.id::text, old.name);
    return old;
  end if;
end;
$$;

create trigger audit_booking_participant_levels_trg
  after insert or update or delete on public.booking_participant_levels
  for each row execute function public.audit_booking_participant_levels();

-- Revisionstaksonomien skal kende det nye handlingspræfiks, ellers lander
-- 'booking_level.*' i restkategorien 'other' i Logs. Funktionen genskrives i
-- sin helhed (den er én case-sætning uden tilstand); klientspejlet er
-- categoryOf() i web/src/routes/_app/operia.logs.tsx, som skal ændres med.
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $$
  select case split_part(coalesce(p_action, ''), '.', 1)
    when 'parcel'         then 'parcels'
    when 'parcel_flow'    then 'parcels'
    when 'employee'       then 'directory'
    when 'department'     then 'directory'
    when 'location'       then 'config'
    when 'handling_class' then 'config'
    when 'carrier'        then 'config'
    when 'general'        then 'config'
    when 'shipping'       then 'shipping'
    when 'agreement'      then 'shipping'
    when 'asset'          then 'assets'
    when 'asset_category' then 'assets'
    when 'asset_location' then 'assets'
    when 'asset_flow'     then 'assets'
    when 'assets'         then 'assets'
    when 'booking'          then 'booking'
    when 'booking_category' then 'booking'
    when 'booking_resource' then 'booking'
    when 'booking_level'    then 'booking'
    when 'inventory_item' then 'inventory'
    when 'locker'         then 'lockers'
    when 'user'           then 'access'
    when 'auth'           then 'access'
    when 'product'        then 'entitlements'
    when 'feature'        then 'entitlements'
    when 'template'       then 'branding'
    when 'language'       then 'branding'
    when 'currency'       then 'branding'
    when 'appearance'     then 'branding'
    when 'product_text'   then 'branding'
    when 'home'           then 'branding'
    when 'handheld'       then 'branding'
    when 'maps'           then 'maps'
    when 'route'          then 'maps'
    when 'import'         then 'imports'
    when 'import_config'  then 'imports'
    when 'data_transfer'  then 'imports'
    when 'log_drain'      then 'log'
    when 'retention'      then 'log'
    when 'ai'             then 'ai'
    when 'privacy'        then 'compliance'
    when 'accounting'     then 'accounting'
    else 'other'
  end
$$;

-- ---------------------------------------------------------------------------
-- 2. Felterne på bookingen
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column participant_count integer,
  add column participant_level_id uuid references public.booking_participant_levels (id) on delete restrict;

alter table public.bookings
  add constraint bookings_participant_count_sane
    check (participant_count is null or participant_count between 1 and 100000);

comment on column public.bookings.participant_count is
  'Antal kursister (EVU A-05). NULL = ikke oplyst — ikke enhver booking er et kursus. Indgår i fakturagrundlaget når C-01/C-07 bygges.';
comment on column public.bookings.participant_level_id is
  'Kursistniveau (EVU A-05), FK til virksomhedens niveauliste. Bærer taksten i C-07, derfor en nøgle og ikke fri tekst.';

-- Tenant-guard: FK-opslag omgår RLS, så tilhørsforholdet valideres eksplicit —
-- samme mønster som ressource og medarbejder.
create or replace function public.bookings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.booking_resources r
    where r.id = new.resource_id and r.company_id = new.company_id
  ) then
    raise exception 'Ressourcen tilhører ikke virksomheden';
  end if;
  if new.employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = new.employee_id and e.company_id = new.company_id
  ) then
    raise exception 'Medarbejderen tilhører ikke virksomheden';
  end if;
  if new.participant_level_id is not null and not exists (
    select 1 from public.booking_participant_levels l
    where l.id = new.participant_level_id and l.company_id = new.company_id
  ) then
    raise exception 'Kursistniveauet tilhører ikke virksomheden';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2b. Fælles regler for de to nye felter (interne, ingen grants)
--
-- Ligger som funktioner og ikke som kode i begge RPC'er, af samme grund som
-- assert_booking_not_retro: reglen skal være ét sted, ellers driver create og
-- update fra hinanden.
-- ---------------------------------------------------------------------------
create or replace function public.assert_booking_level(
  p_company_id uuid,
  p_level_id uuid,
  p_require_active boolean
) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_level public.booking_participant_levels;
begin
  if p_level_id is null then
    return;
  end if;
  select * into v_level from public.booking_participant_levels
   where id = p_level_id and company_id = p_company_id;
  if not found then
    raise exception 'booking_level_not_found' using errcode = 'P0002';
  end if;
  if p_require_active and not v_level.is_active then
    raise exception 'booking_level_inactive' using errcode = 'P0001';
  end if;
end;
$$;

-- Intervallet håndhæves også af check-constrainten; her er formålet en
-- MASKINLÆSBAR kode, klienten kan vise pænt, i stedet for en rå
-- constraint-overtrædelse.
create or replace function public.assert_participant_count(p_count integer)
returns void
language plpgsql immutable as $$
begin
  if p_count is not null and (p_count < 1 or p_count > 100000) then
    raise exception 'booking_invalid_participants' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. RPC'erne
--
-- De gamle signaturer DROPPES først. `create or replace` med en længere
-- parameterliste ville lave en OVERLOAD, ikke en erstatning — og to
-- overloads af samme navn gør PostgREST-kaldet tvetydigt (PGRST203), så
-- klienten ville fejle på hver eneste booking. Grants sættes derfor igen
-- nedenfor.
-- ---------------------------------------------------------------------------
drop function if exists public.create_booking(uuid, uuid, timestamptz, timestamptz, text, boolean);
drop function if exists public.update_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, boolean);

create or replace function public.create_booking(
  p_resource_id uuid,
  p_employee_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text default null,
  p_all_day boolean default false,
  p_participant_count integer default null,
  p_participant_level_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_resource public.booking_resources;
  v_employee public.employees;
  v_id uuid;
begin
  select * into v_resource from public.booking_resources where id = p_resource_id;
  if not found then
    raise exception 'booking_resource_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_bookings(v_resource.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not v_resource.is_active then
    raise exception 'booking_resource_inactive' using errcode = 'P0001';
  end if;

  select * into v_employee from public.employees
    where id = p_employee_id and company_id = v_resource.company_id;
  if not found then
    raise exception 'employee_not_found' using errcode = 'P0002';
  end if;
  if not v_employee.is_active then
    raise exception 'employee_inactive' using errcode = 'P0001';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'booking_invalid_interval' using errcode = 'P0001';
  end if;

  perform public.assert_booking_level(v_resource.company_id, p_participant_level_id, true);
  perform public.assert_participant_count(p_participant_count);
  perform public.assert_booking_not_retro(
    v_resource.company_id, p_starts_at, p_ends_at, p_all_day);

  begin
    insert into public.bookings
      (company_id, resource_id, employee_id, booked_by, starts_at, ends_at, all_day, title,
       participant_count, participant_level_id)
    values
      (v_resource.company_id, v_resource.id, v_employee.id, auth.uid(),
       p_starts_at, p_ends_at, coalesce(p_all_day, false), nullif(btrim(coalesce(p_title, '')), ''),
       p_participant_count, p_participant_level_id)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'booking_overlap' using errcode = 'P0001';
  end;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_id, v_resource.company_id, 'created', auth.uid(),
     jsonb_build_object(
       'resource_id', v_resource.id,
       'employee_id', v_employee.id,
       'starts_at', p_starts_at,
       'ends_at', p_ends_at,
       'all_day', coalesce(p_all_day, false),
       'participant_count', p_participant_count,
       'participant_level_id', p_participant_level_id));

  return v_id;
end;
$$;

revoke execute on function public.create_booking(uuid, uuid, timestamptz, timestamptz, text, boolean, integer, uuid) from public, anon;
grant execute on function public.create_booking(uuid, uuid, timestamptz, timestamptz, text, boolean, integer, uuid) to authenticated;

create or replace function public.update_booking(
  p_booking_id uuid,
  p_resource_id uuid,
  p_employee_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text default null,
  p_all_day boolean default false,
  p_participant_count integer default null,
  p_participant_level_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_booking public.bookings;
  v_resource public.booking_resources;
  v_employee public.employees;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_bookings(v_booking.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_booking.status <> 'booked' then
    raise exception 'booking_not_editable' using errcode = 'P0001';
  end if;
  -- A-03: bookingen kan rettes frem til fakturering — derefter er grundlaget
  -- sendt, og en ændring skal gå gennem en kreditnota (C-09).
  if v_booking.invoiced_at is not null then
    raise exception 'booking_invoiced' using errcode = 'P0001';
  end if;

  select * into v_resource from public.booking_resources
    where id = p_resource_id and company_id = v_booking.company_id;
  if not found then
    raise exception 'booking_resource_not_found' using errcode = 'P0002';
  end if;
  -- En deaktiveret ressource må beholde sine bookinger, men ikke få nye tider:
  -- kun hvis ressourcen er uændret OG tiden er uændret slipper den igennem.
  if not v_resource.is_active
     and (v_resource.id <> v_booking.resource_id
          or p_starts_at is distinct from v_booking.starts_at
          or p_ends_at is distinct from v_booking.ends_at) then
    raise exception 'booking_resource_inactive' using errcode = 'P0001';
  end if;

  select * into v_employee from public.employees
    where id = p_employee_id and company_id = v_booking.company_id;
  if not found then
    raise exception 'employee_not_found' using errcode = 'P0002';
  end if;
  if not v_employee.is_active and v_employee.id <> v_booking.employee_id then
    raise exception 'employee_inactive' using errcode = 'P0001';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'booking_invalid_interval' using errcode = 'P0001';
  end if;

  -- Et deaktiveret niveau må BLIVE på bookingen, men ikke sættes på en ny —
  -- ellers kunne en rettelse af klokkeslættet vælte en booking, hvis niveau
  -- kunden har pensioneret i mellemtiden.
  perform public.assert_booking_level(
    v_booking.company_id, p_participant_level_id,
    p_participant_level_id is distinct from v_booking.participant_level_id);
  perform public.assert_participant_count(p_participant_count);

  -- Retro-reglen rammer kun når tidsrummet ændres — titel/medarbejder på en
  -- igangværende eller afholdt booking kan altid rettes.
  if p_starts_at is distinct from v_booking.starts_at
     or p_ends_at is distinct from v_booking.ends_at then
    perform public.assert_booking_not_retro(
      v_booking.company_id, p_starts_at, p_ends_at, p_all_day);
  end if;

  begin
    update public.bookings
       set resource_id = v_resource.id,
           employee_id = v_employee.id,
           starts_at = p_starts_at,
           ends_at = p_ends_at,
           all_day = coalesce(p_all_day, false),
           title = nullif(btrim(coalesce(p_title, '')), ''),
           participant_count = p_participant_count,
           participant_level_id = p_participant_level_id
     where id = v_booking.id;
  exception when exclusion_violation then
    raise exception 'booking_overlap' using errcode = 'P0001';
  end;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_booking.id, v_booking.company_id, 'updated', auth.uid(),
     jsonb_build_object(
       'from_resource_id', v_booking.resource_id,
       'to_resource_id', v_resource.id,
       'from_employee_id', v_booking.employee_id,
       'to_employee_id', v_employee.id,
       'from_starts_at', v_booking.starts_at,
       'to_starts_at', p_starts_at,
       'from_ends_at', v_booking.ends_at,
       'to_ends_at', p_ends_at,
       -- C-10: ændret deltagerantal skal være sporbart. Bevidst UDEN for
       -- notifikationernes movesSomething()-tjek: et rettet deltagerantal
       -- ændrer fakturagrundlaget, ikke selve mødet, så modtageren skal ikke
       -- have en mail om det.
       'from_participant_count', v_booking.participant_count,
       'to_participant_count', p_participant_count,
       'from_participant_level_id', v_booking.participant_level_id,
       'to_participant_level_id', p_participant_level_id));
end;
$$;

revoke execute on function public.update_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, boolean, integer, uuid) from public, anon;
grant execute on function public.update_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, boolean, integer, uuid) to authenticated;

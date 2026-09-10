-- Tilkøbsydelser pr. booking (EVU-krav A-06): forplejning, overnatning,
-- rengøring og øvrige tilkøb, tilføjet fra en vedligeholdt ydelsesliste med
-- antal og pris.
--
-- To tabeller, fordi kravet er to ting:
--   booking_services       — KATALOGET ("den vedligeholdte ydelsesliste"),
--                            stamdata pr. kunde som ressourcer og kategorier.
--   booking_service_lines  — LINJERNE på den enkelte booking, med antal og
--                            den pris der gjaldt, da linjen blev lagt på.
--
-- PRISMODELLEN
--
-- En ydelse er enten noget man køber ET ANTAL af (forplejning: 18 kuverter)
-- eller et fast beløb (rengøring efter kurset). Feltet hedder `has_quantity`
-- og ikke "countable": det beskriver hvad brugeren skal UDFYLDE, ikke en
-- egenskab ved ydelsen i sig selv. Kan den angives med antal, vælger kunden
-- desuden, om prisen er pr. enhed eller et samlet beløb — derfor `price_mode`.
-- En ydelse uden antal har altid price_mode 'total' (håndhævet nedenfor).
--
-- Linjebeløbet er dermed: 'unit' → antal × pris, 'total' → pris.
--
-- PRISEN SNAPSHOTTES PÅ LINJEN. Krav C-05 siger, at en ændret prisliste ikke
-- må ramme allerede fakturerede bookinger, og det er kun rigtigt sikret, hvis
-- linjen bærer sin egen pris. Prisen kopieres derfor ved tilføjelsen; en
-- rettelse i kataloget slår ikke igennem på linjer, der allerede ligger. Det
-- er den konservative vej: en pris, nogen har set og godkendt, ændrer sig ikke
-- bag ryggen på dem. Skal en linje have den nye pris, fjernes og tilføjes den
-- igen. (Når fakturakladden i C-01 bygges, er det DEN, der afgør, om der skal
-- prissættes om inden fakturering.)
--
-- RETTIGHEDER: kataloget er stamdata og kræver can_manage_bookings (som
-- ressourcer og kategorier). LINJERNE er derimod en del af bookingflowet — den
-- der opretter bookingen, bestiller også forplejningen — så de skrives med
-- can_operate_bookings. Som resten af bookingerne kun gennem RPC'er, og de
-- afvises på en faktureret booking (A-02/A-03-låsen).

-- ---------------------------------------------------------------------------
-- 1. Kataloget
-- ---------------------------------------------------------------------------
create table public.booking_services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  description text,
  -- Angives ydelsen med et antal? (forplejning ja, rengøring typisk nej)
  has_quantity boolean not null default true,
  -- 'unit'  = prisen er pr. enhed, linjebeløb = antal × pris
  -- 'total' = prisen er et samlet beløb, linjebeløb = pris
  price_mode text not null default 'unit',
  unit_price numeric(12, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name),
  constraint booking_services_name_sane
    check (char_length(btrim(name)) between 1 and 120 and name !~ '[[:cntrl:]]'),
  constraint booking_services_description_sane
    check (description is null or
           (char_length(description) <= 500 and description !~ '[[:cntrl:]]')),
  constraint booking_services_price_mode_check check (price_mode in ('unit', 'total')),
  constraint booking_services_price_nonneg check (unit_price >= 0),
  -- Uden antal giver "pris pr. enhed" ingen mening.
  constraint booking_services_mode_needs_quantity
    check (has_quantity or price_mode = 'total')
);

create index booking_services_company_idx on public.booking_services (company_id, name);

alter table public.booking_services enable row level security;

create policy booking_services_select on public.booking_services
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy booking_services_write on public.booking_services
  for all to authenticated
  using (public.can_manage_bookings(company_id))
  with check (public.can_manage_bookings(company_id));

grant select, insert, update, delete on public.booking_services to authenticated;

create or replace function public.audit_booking_services()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'booking_service.created', 'booking_service',
      new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'booking_service.deactivated', 'booking_service',
        new.id::text, new.name);
    elsif old.unit_price is distinct from new.unit_price
       or old.price_mode is distinct from new.price_mode then
      -- Prisændringer er værd at kunne finde igen: de er grundlaget for alt
      -- hvad der senere faktureres.
      perform public.record_audit(new.company_id, 'booking_service.price_changed', 'booking_service',
        new.id::text, new.name,
        jsonb_build_object(
          'from_price', old.unit_price, 'to_price', new.unit_price,
          'from_mode', old.price_mode, 'to_mode', new.price_mode));
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'booking_service.deleted', 'booking_service',
      old.id::text, old.name);
    return old;
  end if;
end;
$$;

create trigger audit_booking_services_trg
  after insert or update or delete on public.booking_services
  for each row execute function public.audit_booking_services();

-- ---------------------------------------------------------------------------
-- 2. Linjerne
--
-- `on delete restrict` fra linjen til ydelsen: en ydelse, der er brugt på en
-- booking, må ikke kunne slettes væk under fakturagrundlaget — den deaktiveres
-- i stedet. Samme valg som kursistniveauerne i 20260908190000.
-- ---------------------------------------------------------------------------
create table public.booking_service_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  service_id uuid not null references public.booking_services (id) on delete restrict,
  quantity integer not null default 1,
  -- Snapshot fra kataloget, se hovedkommentaren.
  unit_price numeric(12, 2) not null,
  price_mode text not null,
  created_at timestamptz not null default now(),
  -- Én linje pr. ydelse pr. booking: antallet er multiplikatoren, så to
  -- identiske linjer ville kun være to måder at skrive det samme på — og et
  -- fakturagrundlag med dubletter er svært at afstemme.
  unique (booking_id, service_id),
  constraint booking_service_lines_quantity_check check (quantity between 1 and 100000),
  constraint booking_service_lines_price_mode_check check (price_mode in ('unit', 'total')),
  constraint booking_service_lines_price_nonneg check (unit_price >= 0)
);

create index booking_service_lines_booking_idx on public.booking_service_lines (booking_id);
create index booking_service_lines_service_idx on public.booking_service_lines (service_id);

alter table public.booking_service_lines enable row level security;

create policy booking_service_lines_select on public.booking_service_lines
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

-- Ingen skrivepolitik: linjerne skrives kun af RPC'erne nedenfor, som bookings.
grant select on public.booking_service_lines to authenticated;

-- Tenant-guard: FK-opslag omgår RLS.
create or replace function public.booking_service_lines_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.bookings b
    where b.id = new.booking_id and b.company_id = new.company_id
  ) then
    raise exception 'Bookingen tilhører ikke virksomheden';
  end if;
  if not exists (
    select 1 from public.booking_services s
    where s.id = new.service_id and s.company_id = new.company_id
  ) then
    raise exception 'Ydelsen tilhører ikke virksomheden';
  end if;
  return new;
end;
$$;

create trigger booking_service_lines_guard
  before insert or update on public.booking_service_lines
  for each row execute function public.booking_service_lines_guard();

-- ---------------------------------------------------------------------------
-- 3. Revisionstaksonomien
--
-- Alle 'booking*'-præfikser samles nu med ét LIKE i stedet for en linje pr.
-- entitet. Hver ny booking-entitet (niveauer, ydelser, …) har hidtil krævet en
-- ny gren her, og det er præcis den slags, man glemmer — konsekvensen er, at
-- handlingen lander i restkategorien 'other' i Logs uden at nogen opdager det.
-- Klientspejlet er categoryOf() i web/src/routes/_app/operia.logs.tsx.
-- ---------------------------------------------------------------------------
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $$
  select case
    when split_part(coalesce(p_action, ''), '.', 1) like 'booking%' then 'booking'
    else case split_part(coalesce(p_action, ''), '.', 1)
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
  end
$$;

-- ---------------------------------------------------------------------------
-- 4. Flow-RPC'er for linjerne
--
-- Fælles vagt: bookingen skal findes, brugeren skal må betjene bookinger, og
-- bookingen må hverken være annulleret eller faktureret. Sidste led er
-- A-03-låsen: efter fakturering ændres grundlaget kun via kreditnota (C-09).
-- ---------------------------------------------------------------------------
create or replace function public.assert_booking_open(p_booking_id uuid)
returns public.bookings
language plpgsql stable security definer set search_path = public as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_bookings(v_booking.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_booking.status <> 'booked' then
    raise exception 'booking_not_editable' using errcode = 'P0001';
  end if;
  if v_booking.invoiced_at is not null then
    raise exception 'booking_invoiced' using errcode = 'P0001';
  end if;
  return v_booking;
end;
$$;

create or replace function public.add_booking_service(
  p_booking_id uuid,
  p_service_id uuid,
  p_quantity integer default 1
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_booking public.bookings;
  v_service public.booking_services;
  v_qty integer;
  v_id uuid;
begin
  v_booking := public.assert_booking_open(p_booking_id);

  select * into v_service from public.booking_services
   where id = p_service_id and company_id = v_booking.company_id;
  if not found then
    raise exception 'booking_service_not_found' using errcode = 'P0002';
  end if;
  if not v_service.is_active then
    raise exception 'booking_service_inactive' using errcode = 'P0001';
  end if;

  -- En ydelse uden antal ligger altid som 1; ellers valideres det oplyste tal.
  v_qty := case when v_service.has_quantity then coalesce(p_quantity, 1) else 1 end;
  if v_qty < 1 or v_qty > 100000 then
    raise exception 'booking_invalid_quantity' using errcode = 'P0001';
  end if;

  begin
    insert into public.booking_service_lines
      (company_id, booking_id, service_id, quantity, unit_price, price_mode)
    values
      (v_booking.company_id, v_booking.id, v_service.id, v_qty,
       v_service.unit_price, v_service.price_mode)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'booking_service_already_added' using errcode = 'P0001';
  end;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_booking.id, v_booking.company_id, 'service_added', auth.uid(),
     jsonb_build_object(
       'service_id', v_service.id,
       'quantity', v_qty,
       'unit_price', v_service.unit_price,
       'price_mode', v_service.price_mode));

  return v_id;
end;
$$;

revoke execute on function public.add_booking_service(uuid, uuid, integer) from public, anon;
grant execute on function public.add_booking_service(uuid, uuid, integer) to authenticated;

create or replace function public.update_booking_service(
  p_line_id uuid,
  p_quantity integer
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_line public.booking_service_lines;
begin
  select * into v_line from public.booking_service_lines where id = p_line_id for update;
  if not found then
    raise exception 'booking_service_line_not_found' using errcode = 'P0002';
  end if;
  perform public.assert_booking_open(v_line.booking_id);

  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception 'booking_invalid_quantity' using errcode = 'P0001';
  end if;

  update public.booking_service_lines set quantity = p_quantity where id = v_line.id;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_line.booking_id, v_line.company_id, 'service_updated', auth.uid(),
     jsonb_build_object(
       'service_id', v_line.service_id,
       'from_quantity', v_line.quantity,
       'to_quantity', p_quantity));
end;
$$;

revoke execute on function public.update_booking_service(uuid, integer) from public, anon;
grant execute on function public.update_booking_service(uuid, integer) to authenticated;

create or replace function public.remove_booking_service(p_line_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_line public.booking_service_lines;
begin
  select * into v_line from public.booking_service_lines where id = p_line_id for update;
  if not found then
    raise exception 'booking_service_line_not_found' using errcode = 'P0002';
  end if;
  perform public.assert_booking_open(v_line.booking_id);

  delete from public.booking_service_lines where id = v_line.id;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_line.booking_id, v_line.company_id, 'service_removed', auth.uid(),
     jsonb_build_object(
       'service_id', v_line.service_id,
       'quantity', v_line.quantity,
       'unit_price', v_line.unit_price,
       'price_mode', v_line.price_mode));
end;
$$;

revoke execute on function public.remove_booking_service(uuid) from public, anon;
grant execute on function public.remove_booking_service(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Opbevaring: linjerne følger bookingen (cascade) og har derfor ikke deres
-- eget vindue. Kataloget er stamdata og slettes kun manuelt.
-- ---------------------------------------------------------------------------
comment on table public.booking_services is
  'Ydelseskatalog pr. kunde (EVU A-06): forplejning, overnatning, rengøring, øvrige tilkøb.';
comment on table public.booking_service_lines is
  'Tilkøbsydelser på den enkelte booking, med antal og prissnapshot. Slettes sammen med bookingen.';

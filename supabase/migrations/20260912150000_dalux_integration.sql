-- Dalux FM-integration, første skive (EVU-krav B-05 .. B-10).
--
-- Dalux FM's REST-API (fm-api.dalux.com, spec på SwaggerHub, v2.5.0) er læst
-- endpoint for endpoint, og to ting styrer designet her:
--
--   1. Der findes INTET booking-objekt i Dalux FM. Objekterne er Estates,
--      Buildings, Floors, Rooms, Assets, WorkOrders, Tickets, Invoices m.fl.
--      Hvad en booking skal blive til (WorkOrder? Ticket?) og om afregnings-
--      linjer skal ind som Invoices, er en AFTALE med kunden (B-08) — ikke en
--      antagelse i koden. Det er derfor kolonner (`booking_target`) med null som
--      "ikke aftalt endnu", og de udgående retninger kan ikke slås til, før de
--      er sat.
--   2. Et Room har IKKE et navnefelt — kun id, etage, arealer og kundens egne
--      "userDefinedFields". Lokalets navn ligger altså i et felt, kunden selv
--      har defineret, og synkroniseringen må spørge hvilket (`room_name_field`).
--
-- Det, der er entydigt og kan bygges nu: opsætning, nøgle, forbindelsestest,
-- tidsplan (B-07), udboks med fejlliste og gensend (B-09), og lokaler → 
-- ressourcer (den indgående halvdel af B-05/B-08).
--
-- Mønstret er Entra-integrationens: konfiguration kunden må læse og skrive,
-- hemmelighed i en tabel UDEN grants som kun edge-funktionen rører, statusfelter
-- som kun service-rollen må skrive, og ét cron-job der spørger "hvem er
-- forfalden". Nøglen forlader aldrig serveren (B-10).

-- ---------------------------------------------------------------------------
-- 1) Platformens hovedafbryder
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists dalux_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2) Pr. virksomhed: konfiguration
-- ---------------------------------------------------------------------------
create table if not exists public.company_dalux_config (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  -- Dalux har et stage-miljø (api.fm-stage.dalux.com). Første nøgle fra kundens
  -- Dalux-admin bør være dér, så en fejl i mapningen ikke rammer produktion.
  environment text not null default 'stage' check (environment in ('production', 'stage')),
  -- Spejles fra company_dalux_secret af trigger; UI ser kun "sat ✓".
  api_key_set boolean not null default false,
  -- Dalux-nøgler udstedes med udløb. Datoen gemmes her (ikke i hemmeligheden),
  -- så skærmen kan advare før en natkørsel fejler.
  api_key_expires_at date,

  -- Hvad der udveksles, og hvilken vej (B-08 som afkrydsninger).
  sync_rooms_in boolean not null default true,
  sync_assets_in boolean not null default false,
  sync_bookings_out boolean not null default false,
  sync_invoices_out boolean not null default false,
  -- Hvad en booking bliver til i Dalux. Null = ikke aftalt; så kan
  -- sync_bookings_out ikke være sand (constraint nedenfor).
  booking_target text check (booking_target in ('workorder', 'ticket')),
  -- Navnet på det brugerdefinerede felt, der bærer lokalets navn.
  room_name_field text,

  -- Tidsplan (B-07). Alt er data; cron-jobbet læser det.
  schedule_mode text not null default 'manual'
    check (schedule_mode in ('manual', 'interval', 'daily', 'weekly', 'monthly')),
  interval_minutes int check (interval_minutes is null or interval_minutes in (15, 60, 240, 720)),
  run_time time,
  run_weekday int check (run_weekday is null or run_weekday between 0 and 6), -- 0 = søndag
  run_monthday int check (run_monthday is null or run_monthday between 1 and 28),

  -- Status: skrives kun af synkroniseringen (service-role).
  verified_at timestamptz,
  verified_detail jsonb,
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('ok', 'partial', 'failed')),
  last_run_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint company_dalux_bookings_need_target
    check (not sync_bookings_out or booking_target is not null),
  constraint company_dalux_schedule_fields check (
    (schedule_mode = 'manual')
    or (schedule_mode = 'interval' and interval_minutes is not null)
    or (schedule_mode = 'daily' and run_time is not null)
    or (schedule_mode = 'weekly' and run_time is not null and run_weekday is not null)
    or (schedule_mode = 'monthly' and run_time is not null and run_monthday is not null)
  ),
  constraint company_dalux_room_field_sane check (
    room_name_field is null
    or (char_length(btrim(room_name_field)) between 1 and 80 and room_name_field !~ '[[:cntrl:]]')
  )
);

drop trigger if exists company_dalux_config_set_updated_at on public.company_dalux_config;
create trigger company_dalux_config_set_updated_at
  before update on public.company_dalux_config
  for each row execute function public.set_updated_at();

alter table public.company_dalux_config enable row level security;

drop policy if exists company_dalux_config_select on public.company_dalux_config;
create policy company_dalux_config_select on public.company_dalux_config
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

drop policy if exists company_dalux_config_write on public.company_dalux_config;
create policy company_dalux_config_write on public.company_dalux_config
  for all to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager'))
         or public.is_platform_admin())
  with check ((company_id = public.current_company_id() and public.has_role('manager'))
              or public.is_platform_admin());

grant select, insert, update, delete on public.company_dalux_config to authenticated;
grant select, insert, update, delete on public.company_dalux_config to service_role;
revoke truncate, trigger on public.company_dalux_config from anon, authenticated;

-- Statusfelterne må klienten ikke kunne forfalske. Skellet er det samme som
-- i Entra-værnet (20260720120400): en slutbruger har altid auth.uid();
-- serveren selv — edge-funktionen, spejltriggeren, pg_cron — har ikke, og
-- den skal netop kunne skrive "nøgle sat" og "sidst kørt".
create or replace function public.guard_dalux_config_status()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null or public.is_platform_admin() then return new; end if;
  new.api_key_set := old.api_key_set;
  new.verified_at := old.verified_at;
  new.verified_detail := old.verified_detail;
  new.last_run_at := old.last_run_at;
  new.last_run_status := old.last_run_status;
  new.last_run_error := old.last_run_error;
  -- Nyt miljø = ny nøgle = ny verifikation.
  if new.environment is distinct from old.environment then
    new.verified_at := null;
    new.verified_detail := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists company_dalux_config_guard_status on public.company_dalux_config;
create trigger company_dalux_config_guard_status
  before update on public.company_dalux_config
  for each row execute function public.guard_dalux_config_status();

-- ---------------------------------------------------------------------------
-- 3) Pr. virksomhed: API-nøglen (KUN service-role)
-- ---------------------------------------------------------------------------
create table if not exists public.company_dalux_secret (
  company_id uuid primary key references public.companies(id) on delete cascade,
  api_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists company_dalux_secret_set_updated_at on public.company_dalux_secret;
create trigger company_dalux_secret_set_updated_at
  before update on public.company_dalux_secret
  for each row execute function public.set_updated_at();

alter table public.company_dalux_secret enable row level security;
revoke all on public.company_dalux_secret from anon, authenticated;
grant select, insert, update, delete on public.company_dalux_secret to service_role;

create or replace function public.sync_dalux_secret_flag()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_company uuid := coalesce(new.company_id, old.company_id);
  v_set boolean := coalesce(new.api_key, '') <> '';
begin
  update public.company_dalux_config
     set api_key_set = v_set,
         -- En ny nøgle er ikke verificeret, før den er testet.
         verified_at = case when v_set then null else verified_at end,
         verified_detail = case when v_set then null else verified_detail end
   where company_id = v_company;
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists company_dalux_secret_mirror_flag on public.company_dalux_secret;
create trigger company_dalux_secret_mirror_flag
  after insert or update or delete on public.company_dalux_secret
  for each row execute function public.sync_dalux_secret_flag();

-- ---------------------------------------------------------------------------
-- 4) Kørsler og udboks (B-09)
-- ---------------------------------------------------------------------------
-- En kørsel er én afvikling af synkroniseringen (manuel eller planlagt).
create table if not exists public.dalux_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'scheduled')),
  actor_user_id uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  -- Tællere pr. objekt: {"rooms": {"seen": 42, "created": 3, "updated": 39, "failed": 0}}
  counts jsonb not null default '{}'::jsonb,
  error text
);
create index if not exists dalux_sync_runs_company_idx on public.dalux_sync_runs (company_id, started_at desc);

-- Udboksen: én række pr. post, der er eller skal udveksles. Idempotensnøglen er
-- det, der gør "gensend" sikkert: samme post to gange giver samme række, ikke
-- to. Indgående poster (lokaler) står her også, så fejllisten er ÉN liste.
create table if not exists public.dalux_sync_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  object_type text not null check (object_type in ('room', 'asset', 'booking', 'invoice')),
  direction text not null check (direction in ('in', 'out')),
  local_id uuid,
  external_id text,
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  last_attempt_at timestamptz,
  run_id uuid references public.dalux_sync_runs(id) on delete set null,
  -- Hvad der blev/skal sendes. Aldrig fritekst fra bookingen (formål,
  -- afbestillingsårsag): udboksen læses af managere og lever længe.
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, idempotency_key)
);
create index if not exists dalux_sync_items_status_idx
  on public.dalux_sync_items (company_id, status, updated_at desc);

drop trigger if exists dalux_sync_items_set_updated_at on public.dalux_sync_items;
create trigger dalux_sync_items_set_updated_at
  before update on public.dalux_sync_items
  for each row execute function public.set_updated_at();

alter table public.dalux_sync_runs enable row level security;
alter table public.dalux_sync_items enable row level security;

-- Læses af managere (fejllisten er deres), skrives kun af service-rollen —
-- bortset fra "gensend", som er en RPC.
drop policy if exists dalux_sync_runs_select on public.dalux_sync_runs;
create policy dalux_sync_runs_select on public.dalux_sync_runs
  for select to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager'))
         or public.is_platform_admin());
drop policy if exists dalux_sync_items_select on public.dalux_sync_items;
create policy dalux_sync_items_select on public.dalux_sync_items
  for select to authenticated
  using ((company_id = public.current_company_id() and public.has_role('manager'))
         or public.is_platform_admin());

grant select on public.dalux_sync_runs, public.dalux_sync_items to authenticated;
revoke insert, update, delete, truncate, trigger on public.dalux_sync_runs, public.dalux_sync_items
  from anon, authenticated;
grant select, insert, update, delete on public.dalux_sync_runs, public.dalux_sync_items to service_role;

-- Gensend (B-09): sætter posten tilbage til afventer. Selve forsøget sker ved
-- næste kørsel, så et "gensend" aldrig omgår kørslens logik og sporet.
create or replace function public.dalux_retry_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_company uuid;
begin
  select company_id into v_company from public.dalux_sync_items where id = p_item_id;
  if v_company is null then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if not ((v_company = public.current_company_id() and public.has_role('manager'))
          or public.is_platform_admin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.dalux_sync_items
     set status = 'pending', last_error = null
   where id = p_item_id and status = 'failed';
  if not found then
    raise exception 'item_not_failed' using errcode = 'P0001';
  end if;
  perform public.record_audit(v_company, 'dalux.item_retried', 'dalux_sync_item',
    p_item_id::text, null);
end;
$fn$;
revoke all on function public.dalux_retry_item(uuid) from public;
grant execute on function public.dalux_retry_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Eksterne id'er på vores side
-- ---------------------------------------------------------------------------
-- Uden dem opretter en gen-synk dubletter. Unik pr. virksomhed: to Dalux-rum
-- kan ikke være samme ressource.
alter table public.booking_resources add column if not exists dalux_room_id text;
create unique index if not exists booking_resources_dalux_room_uidx
  on public.booking_resources (company_id, dalux_room_id) where dalux_room_id is not null;
alter table public.assets add column if not exists dalux_asset_id text;
create unique index if not exists assets_dalux_asset_uidx
  on public.assets (company_id, dalux_asset_id) where dalux_asset_id is not null;

-- ---------------------------------------------------------------------------
-- 6) Hvem er forfalden? (B-07)
-- ---------------------------------------------------------------------------
-- Én funktion, så cron-jobbet og skærmen ("næste kørsel") er enige. Tiderne
-- læses i Europe/Copenhagen: "hver dag kl. 02:00" skal betyde dansk tid, også
-- når serveren tæller i UTC.
create or replace function public.dalux_next_run(c public.company_dalux_config)
returns timestamptz
language plpgsql
stable
as $fn$
declare
  v_last timestamptz := coalesce(c.last_run_at, c.created_at);
  v_local_now timestamp := (now() at time zone 'Europe/Copenhagen');
  v_candidate timestamp;
begin
  if not c.enabled or not c.api_key_set then return null; end if;
  case c.schedule_mode
    when 'manual' then return null;
    when 'interval' then return v_last + make_interval(mins => c.interval_minutes);
    when 'daily' then
      v_candidate := date_trunc('day', v_local_now) + c.run_time;
      if v_candidate <= (v_last at time zone 'Europe/Copenhagen') then
        v_candidate := v_candidate + interval '1 day';
      end if;
      return v_candidate at time zone 'Europe/Copenhagen';
    when 'weekly' then
      v_candidate := date_trunc('week', v_local_now)::date
        + ((c.run_weekday + 6) % 7) * interval '1 day' + c.run_time; -- date_trunc('week') = mandag
      while v_candidate <= (v_last at time zone 'Europe/Copenhagen') loop
        v_candidate := v_candidate + interval '7 days';
      end loop;
      return v_candidate at time zone 'Europe/Copenhagen';
    when 'monthly' then
      v_candidate := date_trunc('month', v_local_now)::date
        + (c.run_monthday - 1) * interval '1 day' + c.run_time;
      while v_candidate <= (v_last at time zone 'Europe/Copenhagen') loop
        v_candidate := (date_trunc('month', v_candidate) + interval '1 month')::date
          + (c.run_monthday - 1) * interval '1 day' + c.run_time;
      end loop;
      return v_candidate at time zone 'Europe/Copenhagen';
  end case;
  return null;
end;
$fn$;
grant execute on function public.dalux_next_run(public.company_dalux_config) to authenticated;

create or replace function public.dalux_due_companies()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select c.company_id
  from public.company_dalux_config c
  where c.enabled
    and c.api_key_set
    and c.verified_at is not null
    and c.schedule_mode <> 'manual'
    and public.dalux_next_run(c) <= now()
    and (select dalux_enabled from public.platform_settings limit 1)
$fn$;
revoke all on function public.dalux_due_companies() from public;

-- ---------------------------------------------------------------------------
-- 7) Spor
-- ---------------------------------------------------------------------------
create or replace function public.audit_company_dalux_config()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'dalux.config_updated', 'company', new.company_id::text,
      null, jsonb_build_object('enabled', new.enabled, 'environment', new.environment,
                               'schedule_mode', new.schedule_mode));
    return new;
  elsif tg_op = 'UPDATE' then
    if old.enabled is distinct from new.enabled
       or old.environment is distinct from new.environment
       or old.schedule_mode is distinct from new.schedule_mode
       or old.sync_rooms_in is distinct from new.sync_rooms_in
       or old.sync_assets_in is distinct from new.sync_assets_in
       or old.sync_bookings_out is distinct from new.sync_bookings_out
       or old.sync_invoices_out is distinct from new.sync_invoices_out
       or old.booking_target is distinct from new.booking_target
       or old.room_name_field is distinct from new.room_name_field then
      perform public.record_audit(new.company_id,
        case when old.enabled and not new.enabled then 'dalux.disabled' else 'dalux.config_updated' end,
        'company', new.company_id::text, null,
        jsonb_build_object('enabled', new.enabled, 'environment', new.environment,
                           'schedule_mode', new.schedule_mode,
                           'rooms_in', new.sync_rooms_in, 'assets_in', new.sync_assets_in,
                           'bookings_out', new.sync_bookings_out, 'invoices_out', new.sync_invoices_out,
                           'booking_target', new.booking_target));
    end if;
    return new;
  end if;
  return old;
end;
$fn$;
drop trigger if exists audit_company_dalux_config_trg on public.company_dalux_config;
create trigger audit_company_dalux_config_trg
  after insert or update on public.company_dalux_config
  for each row execute function public.audit_company_dalux_config();

-- Nøglen sat/fjernet er en hændelse i sig selv — aldrig nøglen.
create or replace function public.audit_company_dalux_secret()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_company uuid := coalesce(new.company_id, old.company_id);
  v_set boolean := coalesce(new.api_key, '') <> '';
begin
  perform public.record_audit(v_company,
    case when v_set then 'dalux.api_key_set' else 'dalux.api_key_cleared' end,
    'company', v_company::text, null);
  return coalesce(new, old);
end;
$fn$;
drop trigger if exists audit_company_dalux_secret_trg on public.company_dalux_secret;
create trigger audit_company_dalux_secret_trg
  after insert or update or delete on public.company_dalux_secret
  for each row execute function public.audit_company_dalux_secret();

-- Kategorien: Dalux-hændelser hører under "Import & eksport" i Logs. Funktionen
-- genskrives i sin helhed, fordi den er én case-liste.
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $fn$
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
      when 'dalux'          then 'imports'
      when 'log_drain'      then 'log'
      when 'retention'      then 'log'
      when 'ai'             then 'ai'
      when 'privacy'        then 'compliance'
      when 'accounting'     then 'accounting'
      when 'email'          then 'email'
      else 'other'
    end
  end
$fn$;

-- ---------------------------------------------------------------------------
-- 8) Cron: hvert 5. minut, kun de forfaldne
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule('operia-dalux-sync')
  where exists (select 1 from cron.job where jobname = 'operia-dalux-sync');

select cron.schedule('operia-dalux-sync', '*/5 * * * *', $job$
do $inner$
declare
  v_key text;
  r uuid;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return; end if;
  for r in select * from public.dalux_due_companies() loop
    perform net.http_post(
      url := 'https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/dalux-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('companyId', r, 'action', 'run', 'trigger', 'scheduled')
    );
  end loop;
end
$inner$;
$job$);

-- Edge-funktionen skriver sporet gennem record_audit med service-rollen. På det
-- hostede projekt har rollen allerede execute; linjen står her, så
-- afhængigheden er synlig og en lokal stak får den med.
grant execute on function public.record_audit(uuid, text, text, text, text, jsonb, uuid) to service_role;

comment on table public.company_dalux_config is
  'Dalux FM-integration pr. kunde (EVU B-05..B-10). booking_target null = objekt ikke aftalt endnu (B-08).';
comment on table public.dalux_sync_items is
  'Udboks/fejlliste for Dalux-synk (B-09). Idempotensnøglen gør gensend sikkert.';

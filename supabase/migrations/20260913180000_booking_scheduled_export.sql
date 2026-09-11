-- Planlagt fileksport af bookinger (EVU-krav B-02).
--
-- "Eksporten skal kunne køres både on-demand og planlagt." On-demand findes
-- (B-01). Planlagt betyder: en fil dannes uden at nogen klikker, på et
-- tidspunkt kunden har valgt, for en periode kunden har valgt, og lander et
-- sted, hvor kunden (eller kundens FM-system) kan hente den.
--
-- Filen dannes SERVERSIDE af edge-funktionen booking-export-run — browseren
-- er ikke der om natten. Den lægges i den private bucket 'exports' under
-- virksomhedens mappe, registreres i booking_export_files, og modtageren får
-- en mail med et signeret link. Filerne kan også hentes fra Konfigurér →
-- Booking. Samme kolonner og profiler som den manuelle eksport, så et
-- FM-system, der er sat op til den ene, kan læse den anden.
--
-- Tidsplanen genbruger Dalux-synkens mønster: alt er data, ét cron-job hvert
-- 5. minut spørger hvem der er forfalden.

create table if not exists public.company_booking_export_schedule (
  company_id uuid primary key references public.companies(id) on delete cascade,
  enabled boolean not null default false,
  frequency text not null default 'weekly' check (frequency in ('daily', 'weekly', 'monthly')),
  run_time time not null default '06:00',
  run_weekday int check (run_weekday is null or run_weekday between 0 and 6),
  run_monthday int check (run_monthday is null or run_monthday between 1 and 28),
  -- Hvilken periode filen dækker, regnet fra kørselstidspunktet.
  period text not null default 'previous_week'
    check (period in ('previous_day', 'previous_week', 'previous_month', 'last_30_days')),
  shape text not null default 'bookings' check (shape in ('bookings', 'lines')),
  profile text not null default 'excel_da' check (profile in ('operia', 'excel_da')),
  recipient_email text
    check (recipient_email is null or
           (recipient_email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'
            and char_length(recipient_email) <= 320)),
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('ok', 'failed')),
  last_run_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_export_schedule_fields check (
    (frequency = 'daily')
    or (frequency = 'weekly' and run_weekday is not null)
    or (frequency = 'monthly' and run_monthday is not null)
  )
);
drop trigger if exists company_booking_export_schedule_set_updated_at on public.company_booking_export_schedule;
create trigger company_booking_export_schedule_set_updated_at
  before update on public.company_booking_export_schedule
  for each row execute function public.set_updated_at();

alter table public.company_booking_export_schedule enable row level security;
drop policy if exists booking_export_schedule_select on public.company_booking_export_schedule;
create policy booking_export_schedule_select on public.company_booking_export_schedule
  for select to authenticated
  using ((company_id = public.current_company_id()
          and public.has_any_role('manager', 'booking_manager', 'finance_manager'))
         or public.is_platform_admin());
drop policy if exists booking_export_schedule_write on public.company_booking_export_schedule;
create policy booking_export_schedule_write on public.company_booking_export_schedule
  for all to authenticated
  using (public.can_manage_bookings(company_id))
  with check (public.can_manage_bookings(company_id));
grant select, insert, update, delete on public.company_booking_export_schedule to authenticated, service_role;
revoke truncate, trigger on public.company_booking_export_schedule from anon, authenticated;

-- Statusfelterne skrives kun af serveren (samme skel som Dalux/Entra).
create or replace function public.guard_booking_export_schedule_status()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null or public.is_platform_admin() then return new; end if;
  new.last_run_at := old.last_run_at;
  new.last_run_status := old.last_run_status;
  new.last_run_error := old.last_run_error;
  return new;
end;
$fn$;
drop trigger if exists booking_export_schedule_guard on public.company_booking_export_schedule;
create trigger booking_export_schedule_guard
  before update on public.company_booking_export_schedule
  for each row execute function public.guard_booking_export_schedule_status();

-- ---------------------------------------------------------------------------
-- Filerne
-- ---------------------------------------------------------------------------
create table if not exists public.booking_export_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  trigger text not null check (trigger in ('scheduled', 'manual')),
  period_from date not null,
  period_to date not null,
  shape text not null,
  profile text not null,
  rows integer not null default 0,
  storage_path text,
  bytes integer,
  delivered_to text,
  status text not null check (status in ('ok', 'failed')),
  error text
);
create index if not exists booking_export_files_company_idx on public.booking_export_files (company_id, created_at desc);
alter table public.booking_export_files enable row level security;
drop policy if exists booking_export_files_select on public.booking_export_files;
create policy booking_export_files_select on public.booking_export_files
  for select to authenticated
  using ((company_id = public.current_company_id()
          and public.has_any_role('manager', 'booking_manager', 'finance_manager'))
         or public.is_platform_admin());
grant select on public.booking_export_files to authenticated;
grant select, insert, update, delete on public.booking_export_files to service_role;
revoke insert, update, delete, truncate, trigger on public.booking_export_files from anon, authenticated;

-- Bucket + læsepolitik: mappen er virksomheden, som de andre buckets.
insert into storage.buckets (id, name, public) values ('exports', 'exports', false)
on conflict (id) do nothing;
drop policy if exists exports_select on storage.objects;
create policy exports_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exports'
    and (((storage.foldername(name))[1] = public.current_company_id()::text
          and public.has_any_role('manager', 'booking_manager', 'finance_manager'))
         or public.is_platform_admin())
  );

-- ---------------------------------------------------------------------------
-- Forfalden?
-- ---------------------------------------------------------------------------
-- Samme regnestykke som dalux_next_run, generaliseret til (frekvens, tid,
-- ugedag, månedsdag). Dansk tid.
create or replace function public.schedule_next_run(
  p_frequency text, p_run_time time, p_weekday int, p_monthday int, p_last timestamptz)
returns timestamptz
language plpgsql
stable
as $fn$
declare
  v_local_now timestamp := (now() at time zone 'Europe/Copenhagen');
  v_last_local timestamp := (p_last at time zone 'Europe/Copenhagen');
  v_candidate timestamp;
begin
  case p_frequency
    when 'daily' then
      v_candidate := date_trunc('day', v_local_now) + p_run_time;
      if v_candidate <= v_last_local then v_candidate := v_candidate + interval '1 day'; end if;
    when 'weekly' then
      v_candidate := date_trunc('week', v_local_now)::date + ((coalesce(p_weekday, 1) + 6) % 7) * interval '1 day' + p_run_time;
      while v_candidate <= v_last_local loop v_candidate := v_candidate + interval '7 days'; end loop;
    when 'monthly' then
      v_candidate := date_trunc('month', v_local_now)::date + (coalesce(p_monthday, 1) - 1) * interval '1 day' + p_run_time;
      while v_candidate <= v_last_local loop
        v_candidate := (date_trunc('month', v_candidate) + interval '1 month')::date + (coalesce(p_monthday, 1) - 1) * interval '1 day' + p_run_time;
      end loop;
    else return null;
  end case;
  return v_candidate at time zone 'Europe/Copenhagen';
end;
$fn$;
grant execute on function public.schedule_next_run(text, time, int, int, timestamptz) to authenticated;

create or replace function public.booking_export_due_companies()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select s.company_id
  from public.company_booking_export_schedule s
  where s.enabled
    and s.recipient_email is not null
    and public.schedule_next_run(s.frequency, s.run_time, s.run_weekday, s.run_monthday,
                                 coalesce(s.last_run_at, s.created_at)) <= now()
$fn$;
revoke all on function public.booking_export_due_companies() from public;

-- Perioden, regnet i dansk tid, som edge-funktionen bruger — ét sted, så
-- "forrige uge" betyder det samme i loggen og i filen.
create or replace function public.booking_export_period(p_period text, p_at timestamptz default now())
returns table (period_from date, period_to date, from_ts timestamptz, to_ts timestamptz)
language sql
immutable
as $fn$
  with p as (
    select
      case p_period
        when 'previous_day' then (p_at at time zone 'Europe/Copenhagen')::date - 1
        when 'previous_week' then (date_trunc('week', (p_at at time zone 'Europe/Copenhagen')) - interval '7 days')::date
        when 'previous_month' then (date_trunc('month', (p_at at time zone 'Europe/Copenhagen')) - interval '1 month')::date
        else (p_at at time zone 'Europe/Copenhagen')::date - 30
      end as f,
      case p_period
        when 'previous_day' then (p_at at time zone 'Europe/Copenhagen')::date - 1
        when 'previous_week' then (date_trunc('week', (p_at at time zone 'Europe/Copenhagen')) - interval '1 day')::date
        when 'previous_month' then (date_trunc('month', (p_at at time zone 'Europe/Copenhagen')) - interval '1 day')::date
        else (p_at at time zone 'Europe/Copenhagen')::date - 1
      end as t
  )
  -- Grænserne som timestamptz i dansk tid, så edge-funktionen ikke skal kende
  -- sommer-/vintertid.
  select f, t, f::timestamp at time zone 'Europe/Copenhagen', (t + 1)::timestamp at time zone 'Europe/Copenhagen' from p
$fn$;
grant execute on function public.booking_export_period(text, timestamptz) to authenticated, service_role;

-- Cron: hvert 5. minut, kun de forfaldne.
select cron.unschedule('operia-booking-export')
  where exists (select 1 from cron.job where jobname = 'operia-booking-export');
select cron.schedule('operia-booking-export', '*/5 * * * *', $job$
do $inner$
declare v_key text; r uuid;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return; end if;
  for r in select * from public.booking_export_due_companies() loop
    perform net.http_post(
      url := 'https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/booking-export-run',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('companyId', r, 'trigger', 'scheduled')
    );
  end loop;
end
$inner$;
$job$);

-- Sporet: 'scheduled' som udsnit, og service-rollen (ingen auth.uid) må logge.
CREATE OR REPLACE FUNCTION public.log_booking_export(p_company_id uuid, p_scope text, p_rows integer, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scope text;
  v_shape text;
  v_profile text;
  v_columns jsonb;
  v_entity text;
begin
  if auth.uid() is not null and not public.can_edit_invoice_drafts(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_scope := case
    when p_scope in ('booking', 'resource', 'timeframe', 'filtered', 'selected', 'history', 'report', 'scheduled')
      then p_scope
    else 'other'
  end;
  v_shape := case
    when p_detail->>'shape' in ('bookings', 'lines', 'history', 'report') then p_detail->>'shape'
    else 'other'
  end;
  v_profile := case
    when p_detail->>'profile' in ('operia', 'excel_da', 'dalux', 'csv', 'pdf', 'docx')
      then p_detail->>'profile'
    else 'other'
  end;

  select coalesce(jsonb_agg(c order by c), '[]'::jsonb) into v_columns
  from (
    select value as c
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_detail->'columns') = 'array'
           then p_detail->'columns' else '[]'::jsonb end)
    where value ~ '^[a-z][a-z_]{0,39}$'
    limit 40
  ) x;

  v_entity := case
    when p_detail->>'entity_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then p_detail->>'entity_id'
    else p_company_id::text
  end;

  perform public.record_audit(
    p_company_id, 'booking.exported', 'booking', v_entity,
    greatest(0, coalesce(p_rows, 0))::text,
    jsonb_build_object(
      'scope', v_scope,
      'rows', greatest(0, coalesce(p_rows, 0)),
      'shape', v_shape,
      'profile', v_profile,
      'columns', v_columns));
end;
$function$;
grant execute on function public.log_booking_export(uuid, text, integer, jsonb) to service_role;

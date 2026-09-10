-- Rettelser efter kodegennemgang 2026-09-12 (kundeudtræk F-08 + booking-audit).
--
-- 1. company_export_catalog: booking_tariffs (20260911180000, prisgrundlaget
--    bag hver faktureret booking) manglede i hvidlisten. Hvidlisten er
--    håndskrevet, så den får en makker: company_export_excluded() navngiver de
--    company_id-tabeller, der BEVIDST holdes ude, og fixturen
--    (tests/company_full_export.sql, prøve 8) fejler, hvis en tabel med
--    company_id hverken står i hvidlisten eller i undtagelserne. En ny
--    kundetabel kan dermed ikke falde stille ud af udtrækket.
-- 2. Sporet skrives SERVERSIDE. Før: manifest/rows var `stable` og skrev
--    intet; 'privacy.full_export' fandtes kun hvis browseren kaldte
--    log_company_export bagefter — efter at ZIP'en var hentet. Et direkte
--    RPC-kald efterlod intet spor. Nu:
--      company_export_begin()  — VOLATILE; logger 'privacy.full_export' med
--                                serverberegnede tal og et export_id, og
--                                returnerer manifestet + id'et (billetten).
--      company_export_rows()   — kræver billetten: en frisk (12 t) loglinje af
--                                samme aktør for samme virksomhed, hvis
--                                gruppeliste rummer tabellen. Uden billet:
--                                ingen rækker, og ingen rækker uden spor.
--      log_company_export()    — kvitteringen: 'privacy.full_export_delivered'
--                                (niveau success) med det faktiske indhold.
--    company_export_manifest() forbliver stable og ulogget: den er
--    dialogens rækketælling, og et tal pr. afkrydsning er ikke en udlevering.
-- 3. company_export_rows: nøglesat paginering på id'ets EGEN type
--    (uuid/bigint) i stedet for id::text — text-sammenligningen var uden
--    indeks (kvadratisk over siderne) og sorterede bigint leksikografisk.
-- 4. audit_bookings_row: starts_at/ends_at/all_day som kontekst på
--    cancelled/invoiced/invoice_cleared. Før triggeren skrev RPC'erne dem selv;
--    triggeren tabte dem, og audit_log-spejlingen var ikke selvbærende efter
--    en opbevaringsoprydning.

-- ---------------------------------------------------------------------------
-- 1) Hvidliste + undtagelser
-- ---------------------------------------------------------------------------
create or replace function public.company_export_catalog()
returns table (grp text, tbl text, ord integer)
language sql
immutable
as $fn$
  select * from (values
    -- Kerne: det der findes uanset hvilke produkter kunden har købt.
    ('core', 'companies',                   10),
    ('core', 'app_users',                   20),
    ('core', 'employees',                   30),
    ('core', 'departments',                 40),
    ('core', 'company_products',            50),
    ('core', 'company_features',            60),
    ('core', 'company_retention',           70),
    ('core', 'company_templates',           80),
    ('core', 'app_text_override',           90),
    ('core', 'company_home_config',        100),
    ('core', 'company_handheld_config',    110),
    ('core', 'product_appearance',         120),
    ('core', 'company_ai_config',          130),
    ('core', 'company_accounting_config',  140),
    ('core', 'company_data_transfer',      150),
    ('core', 'company_entra_config',       160),
    ('core', 'company_slack_config',       170),
    ('core', 'log_drains',                 180),
    ('core', 'account_emails',             190),
    ('core', 'import_configs',             200),
    ('core', 'import_runs',                210),
    ('core', 'inbound_files',              220),
    ('core', 'feedback',                   230),
    ('core', 'audit_log',                  240),

    ('parcels', 'parcels',                 10),
    ('parcels', 'parcel_events',           20),
    ('parcels', 'parcel_batches',          30),
    ('parcels', 'parcel_documents',        40),
    ('parcels', 'parcel_notifications',    50),
    ('parcels', 'storage_locations',       60),
    ('parcels', 'handling_classes',        70),
    ('parcels', 'carriers',                80),

    ('assets', 'assets',                   10),
    ('assets', 'asset_categories',         20),
    ('assets', 'asset_locations',          30),
    ('assets', 'asset_events',             40),
    ('assets', 'asset_loans',              50),
    ('assets', 'asset_loan_notifications', 60),
    ('assets', 'asset_documents',          70),

    ('lager',    'inventory_items',        10),
    ('lockers',  'lockers',                10),
    ('shipping', 'carrier_agreements',     10),
    ('routes',   'routes',                 10),

    ('booking', 'bookings',                    10),
    ('booking', 'booking_events',              20),
    ('booking', 'booking_resources',           30),
    ('booking', 'booking_categories',          40),
    ('booking', 'booking_services',            50),
    ('booking', 'booking_service_lines',       60),
    ('booking', 'booking_participant_levels',  70),
    ('booking', 'booking_notifications',       80),
    ('booking', 'booking_tariffs',             90)
  ) as v(grp, tbl, ord)
$fn$;

create or replace function public.company_export_excluded()
returns table (tbl text, reason text)
language sql
immutable
as $fn$
  select * from (values
    -- Adgangsnøgler til kundens andre systemer — ikke kundens data.
    ('company_accounting_secret',    'secret'),
    ('company_data_transfer_secret', 'secret'),
    ('company_entra_secret',         'secret'),
    ('company_slack_secret',         'secret'),
    ('slack_oauth_state',            'secret'),
    -- Interne tællere og låse uden informationsindhold.
    ('asset_no_seq',       'counter'),
    ('parcel_barcode_seq', 'counter'),
    ('import_locks',       'counter')
  ) as v(tbl, reason)
$fn$;

comment on function public.company_export_excluded() is
  'company_id-tabeller der bevidst IKKE indgår i kundeudtrækket (F-08), med begrundelse. Fixturen kræver at enhver company_id-tabel står enten her eller i company_export_catalog().';

-- ---------------------------------------------------------------------------
-- 2) Billetten
-- ---------------------------------------------------------------------------
create or replace function public.company_export_ticket_ok(
  p_company_id uuid,
  p_export_id uuid,
  p_table text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select p_export_id is not null and exists (
    select 1 from public.audit_log a
    where a.action = 'privacy.full_export'
      and a.company_id = p_company_id
      and a.actor_user_id = auth.uid()
      and a.detail->>'export_id' = p_export_id::text
      and a.created_at > now() - interval '12 hours'
      and (p_table is null or (a.detail->'groups') ? coalesce(
            (select c.grp from public.company_export_catalog() c where c.tbl = p_table), ''))
  )
$fn$;

create or replace function public.company_export_begin(
  p_company_id uuid,
  p_groups text[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_manifest jsonb;
  v_id uuid := gen_random_uuid();
  v_groups text[];
begin
  if not public.company_export_allowed(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_manifest := public.company_export_manifest(p_company_id, p_groups);

  -- Gruppenavnene hvidlistes: loggen er uforanderlig og videresendes til
  -- kundens log drains, så intet frit skrevet må lande i den.
  select coalesce(array_agg(distinct c.grp order by c.grp), '{}'::text[])
    into v_groups
  from public.company_export_catalog() c
  where c.grp = any(coalesce(p_groups, '{}'::text[]));

  perform public.record_audit(
    p_company_id,
    'privacy.full_export',
    'company',
    p_company_id::text,
    null,
    jsonb_build_object(
      'export_id', v_id,
      'groups', to_jsonb(v_groups),
      'tables', jsonb_array_length(coalesce(v_manifest->'tables', '[]'::jsonb)),
      'rows', coalesce((v_manifest->>'total_rows')::bigint, 0)
    )
  );

  return v_manifest || jsonb_build_object('export_id', v_id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3) Rækkerne — kræver billet, typet nøglesat paginering
-- ---------------------------------------------------------------------------
drop function if exists public.company_export_rows(uuid, text, text, integer);

create or replace function public.company_export_rows(
  p_company_id uuid,
  p_table text,
  p_export_id uuid,
  p_after text default null,
  p_limit integer default 2000
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_ok boolean;
  v_id_type text;
  v_limit integer := least(greatest(coalesce(p_limit, 2000), 1), 5000);
begin
  if not public.company_export_allowed(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select exists (select 1 from public.company_export_catalog() c where c.tbl = p_table)
    into v_ok;
  if not v_ok then
    raise exception 'table_not_exportable' using errcode = 'P0001';
  end if;

  if not public.company_export_ticket_ok(p_company_id, p_export_id, p_table) then
    raise exception 'export_not_started' using errcode = '42501';
  end if;

  if p_table = 'companies' then
    return query
      select public.company_export_mask('companies', to_jsonb(t))
      from public.companies t where t.id = p_company_id;
    return;
  end if;

  select c.data_type into v_id_type
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = p_table and c.column_name = 'id';

  if v_id_type in ('uuid', 'bigint', 'integer') then
    -- Markøren castes til id'ets egen type, så primærnøglens indeks bærer
    -- både filtret og sorteringen. Klienten sender stadig markøren som tekst.
    return query execute format(
      'select public.company_export_mask(%L, to_jsonb(t)) from public.%I t
         where t.company_id = $1 and ($2 is null or t.id > $2::%s)
         order by t.id limit %s', p_table, p_table, v_id_type, v_limit)
      using p_company_id, p_after;
  elsif v_id_type is not null then
    return query execute format(
      'select public.company_export_mask(%L, to_jsonb(t)) from public.%I t
         where t.company_id = $1 and ($2 is null or t.id::text > $2)
         order by t.id::text limit %s', p_table, p_table, v_limit)
      using p_company_id, p_after;
  else
    return query execute format(
      'select public.company_export_mask(%L, to_jsonb(t)) from public.%I t
         where t.company_id = $1 limit %s', p_table, p_table, v_limit)
      using p_company_id;
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4) Kvitteringen
-- ---------------------------------------------------------------------------
drop function if exists public.log_company_export(uuid, text[], integer, integer, integer);

create or replace function public.log_company_export(
  p_company_id uuid,
  p_export_id uuid,
  p_tables integer,
  p_rows integer,
  p_files integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if not public.company_export_allowed(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.company_export_ticket_ok(p_company_id, p_export_id) then
    raise exception 'export_not_started' using errcode = '42501';
  end if;

  perform public.record_audit(
    p_company_id,
    'privacy.full_export_delivered',
    'company',
    p_company_id::text,
    null,
    jsonb_build_object(
      'export_id', p_export_id,
      'tables', greatest(coalesce(p_tables, 0), 0),
      'rows', greatest(coalesce(p_rows, 0), 0),
      'files', greatest(coalesce(p_files, 0), 0)
    )
  );
end;
$fn$;

revoke all on function public.company_export_excluded() from public;
revoke all on function public.company_export_ticket_ok(uuid, uuid, text) from public;
revoke all on function public.company_export_begin(uuid, text[]) from public;
revoke all on function public.company_export_rows(uuid, text, uuid, text, integer) from public;
revoke all on function public.log_company_export(uuid, uuid, integer, integer, integer) from public;

grant execute on function public.company_export_excluded() to authenticated;
grant execute on function public.company_export_begin(uuid, text[]) to authenticated;
grant execute on function public.company_export_rows(uuid, text, uuid, text, integer) to authenticated;
grant execute on function public.log_company_export(uuid, uuid, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Booking-audit: tidsrum som kontekst (krop = 20260910160000 + blokken)
-- ---------------------------------------------------------------------------
create or replace function public.audit_bookings_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_detail jsonb := '{}'::jsonb;
  v_type text;
begin
  if tg_op = 'INSERT' then
    insert into public.booking_events
      (booking_id, company_id, event_type, actor_user_id, detail)
    values
      (new.id, new.company_id, 'created', auth.uid(),
       jsonb_build_object(
         'resource_id', new.resource_id,
         'employee_id', new.employee_id,
         'starts_at', new.starts_at,
         'ends_at', new.ends_at,
         'all_day', new.all_day,
         'participant_count', new.participant_count,
         'participant_level_id', new.participant_level_id,
         'has_title', new.title is not null));
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Opbevaringspurgen logger sin egen optælling; her ville vi kun tilføje
    -- én række pr. slettet booking i den log, purgen netop rydder op i.
    if coalesce(current_setting('operia.retention_purge', true), '') = 'on' then
      return old;
    end if;
    perform public.record_audit(
      old.company_id, 'booking.deleted', 'booking', old.id::text, null,
      jsonb_build_object(
        'resource_id', old.resource_id,
        'starts_at', old.starts_at,
        'ends_at', old.ends_at,
        'status', old.status));
    return old;
  end if;

  -- UPDATE: kun de felter der FAKTISK ændrede sig kommer med. At parret er der,
  -- betyder at værdien flyttede sig — det er dét, notifikationernes
  -- movesSomething() læser, og det gør loggen læsbar for et menneske.
  if new.resource_id is distinct from old.resource_id then
    v_detail := v_detail || jsonb_build_object(
      'from_resource_id', old.resource_id, 'to_resource_id', new.resource_id);
  end if;
  if new.employee_id is distinct from old.employee_id then
    v_detail := v_detail || jsonb_build_object(
      'from_employee_id', old.employee_id, 'to_employee_id', new.employee_id);
  end if;
  if new.starts_at is distinct from old.starts_at then
    v_detail := v_detail || jsonb_build_object(
      'from_starts_at', old.starts_at, 'to_starts_at', new.starts_at);
  end if;
  if new.ends_at is distinct from old.ends_at then
    v_detail := v_detail || jsonb_build_object(
      'from_ends_at', old.ends_at, 'to_ends_at', new.ends_at);
  end if;
  if new.all_day is distinct from old.all_day then
    v_detail := v_detail || jsonb_build_object(
      'from_all_day', old.all_day, 'to_all_day', new.all_day);
  end if;
  if new.participant_count is distinct from old.participant_count then
    v_detail := v_detail || jsonb_build_object(
      'from_participant_count', old.participant_count,
      'to_participant_count', new.participant_count);
  end if;
  if new.participant_level_id is distinct from old.participant_level_id then
    v_detail := v_detail || jsonb_build_object(
      'from_participant_level_id', old.participant_level_id,
      'to_participant_level_id', new.participant_level_id);
  end if;
  if new.status is distinct from old.status then
    v_detail := v_detail || jsonb_build_object(
      'from_status', old.status, 'to_status', new.status);
  end if;
  if new.invoiced_at is distinct from old.invoiced_at then
    v_detail := v_detail || jsonb_build_object(
      'from_invoiced_at', old.invoiced_at, 'to_invoiced_at', new.invoiced_at);
  end if;
  -- Fritekst: kun kendsgerningen, aldrig indholdet (se hovedkommentaren).
  if new.title is distinct from old.title then
    v_detail := v_detail || jsonb_build_object('title_changed', true);
  end if;
  if new.cancellation_reason is distinct from old.cancellation_reason then
    v_detail := v_detail || jsonb_build_object('reason_changed', true);
  end if;

  -- Et gem uden ændringer er ikke en hændelse.
  if v_detail = '{}'::jsonb then
    return new;
  end if;

  v_type := case
    when old.status = 'booked' and new.status = 'cancelled' then 'cancelled'
    when old.invoiced_at is null and new.invoiced_at is not null then 'invoiced'
    when old.invoiced_at is not null and new.invoiced_at is null then 'invoice_cleared'
    else 'updated'
  end;

  -- Kontekst på de hændelser, et menneske slår op i Logs.
  -- Ressource OG tidsrum: den uforanderlige audit_log-spejling skal kunne
  -- fortælle hvilken tid bookingen optog, også efter at bookingen selv og
  -- dens booking_events er ryddet af opbevaringspolitikken.
  if v_type <> 'updated' then
    v_detail := v_detail || jsonb_build_object(
      'resource_id', new.resource_id,
      'starts_at', new.starts_at,
      'ends_at', new.ends_at,
      'all_day', new.all_day);
  end if;
  if v_type = 'cancelled' then
    v_detail := v_detail || jsonb_build_object(
      'has_reason', new.cancellation_reason is not null);
  end if;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (new.id, new.company_id, v_type, auth.uid(), v_detail);

  return new;
end;
$fn$;

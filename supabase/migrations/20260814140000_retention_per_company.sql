-- Opbevaringsperioder pr. kunde (GDPR art. 5(1)(e), "opbevaringsbegrænsning").
--
-- Hidtil: tre vinduer på platform_settings (revisionslog, import, pakkefiler),
-- alle NULL = gem for evigt, kun redigerbare med SQL. To problemer:
--
--   1. Opbevaringsperioden er DEN DATAANSVARLIGES beslutning, ikke DCA's.
--      Kunden kunne ikke sætte den — det er en rollefejl, ikke bare en
--      manglende skærm.
--   2. Pakker, beskedlog, udlånshistorik, medarbejdere og ruter havde slet
--      intet vindue. "Vi sletter aldrig" er ikke en opbevaringspolitik.
--
-- Her indføres otte kategorier med et vindue pr. kunde, der arver platformens
-- standard når kunden ikke selv har sat et. NULL på begge niveauer = gem for
-- evigt (uændret, bagudkompatibel adfærd — intet slettes af denne migration).
--
-- Bevidst UDEN eget vindue: forsendelseshistorikken (parcel_events). Den er
-- kæden af overdragelser og følger pakkens levetid — slettes pakken, går
-- hændelserne med (se purge-funktionen). En sletteanmodning imødekommes ved at
-- anonymisere personen, ikke ved at omskrive historikken.
--
-- Se docs/gdpr/retention-schedule.md og docs/gdpr/dpa/bilag-da.md C.4.

-- ---------------------------------------------------------------------------
-- 1. Platformens standardvinduer for de fem nye kategorier.
--    (audit/import/parcel_files findes allerede på platform_settings.)
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists parcels_retention_days integer,
  add column if not exists notifications_retention_days integer,
  add column if not exists asset_loans_retention_days integer,
  add column if not exists employees_retention_days integer,
  add column if not exists routes_retention_days integer;

alter table public.platform_settings
  add constraint platform_settings_retention_positive check (
    coalesce(parcels_retention_days, 1) > 0
    and coalesce(notifications_retention_days, 1) > 0
    and coalesce(asset_loans_retention_days, 1) > 0
    and coalesce(employees_retention_days, 1) > 0
    and coalesce(routes_retention_days, 1) > 0
  );

-- ---------------------------------------------------------------------------
-- 2. Kundens egne vinduer. Én række pr. virksomhed; NULL i en kolonne = arv
--    platformens standard for netop den kategori.
-- ---------------------------------------------------------------------------
create table public.company_retention (
  company_id uuid primary key references public.companies (id) on delete cascade,
  parcels_days integer,
  parcel_files_days integer,
  notifications_days integer,
  audit_days integer,
  imports_days integer,
  asset_loans_days integer,
  employees_days integer,
  routes_days integer,
  updated_at timestamptz not null default now(),
  constraint company_retention_positive check (
    coalesce(parcels_days, 1) > 0
    and coalesce(parcel_files_days, 1) > 0
    and coalesce(notifications_days, 1) > 0
    and coalesce(audit_days, 1) > 0
    and coalesce(imports_days, 1) > 0
    and coalesce(asset_loans_days, 1) > 0
    and coalesce(employees_days, 1) > 0
    and coalesce(routes_days, 1) > 0
  )
);

comment on table public.company_retention is
  'Opbevaringsvinduer pr. kunde i dage. NULL = arv platform_settings; NULL begge steder = gem for evigt. Se docs/gdpr/.';

create trigger company_retention_set_updated_at
  before update on public.company_retention
  for each row execute function public.set_updated_at();

alter table public.company_retention enable row level security;

-- Kunden er dataansvarlig og bestemmer selv sine vinduer; platform-admin kan
-- se og sætte dem for enhver kunde (support + standardopsætning).
create policy company_retention_select on public.company_retention
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy company_retention_insert on public.company_retention
  for insert to authenticated
  with check (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

create policy company_retention_update on public.company_retention
  for update to authenticated
  using (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  )
  with check (
    (company_id = public.current_company_id() and public.has_role('manager'))
    or public.is_platform_admin()
  );

-- Ingen delete-politik: en tom række betyder "arv alt", så der er ingen grund
-- til at slette den (og ingen vej til utilsigtet tab af politikken).
grant select, insert, update on public.company_retention to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Audit. Værdierne er tal, ikke personoplysninger, så de logges direkte —
--    en ændret opbevaringsperiode er præcis den slags beslutning et tilsyn
--    skal kunne følge (hvem forkortede loggen, og hvornår).
-- ---------------------------------------------------------------------------
create or replace function public.audit_company_retention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) - 'updated_at' - 'company_id' else null end;
  v_after  jsonb := to_jsonb(new) - 'updated_at' - 'company_id';
begin
  if tg_op = 'UPDATE' and v_before = v_after then
    return new;
  end if;
  perform public.record_audit(new.company_id, 'retention.company_changed', 'company_retention',
    new.company_id::text, null,
    jsonb_build_object('from', v_before, 'to', v_after));
  return new;
end;
$$;

create trigger audit_company_retention_trg
  after insert or update on public.company_retention
  for each row execute function public.audit_company_retention();

-- ---------------------------------------------------------------------------
-- 4. Det effektive vindue: kundens valg, ellers platformens standard.
--    Ét sted, så UI, purge og eventuelle rapporter ikke kan regne forskelligt.
-- ---------------------------------------------------------------------------
--    SECURITY DEFINER omgår RLS, så adgangen afgøres her: en indlogget bruger
--    må kun spørge om sin EGEN virksomhed (platform-admins om alle), mens
--    service-rollen — som ikke har nogen auth.uid() — slipper igennem, fordi
--    det daglige parcel-files-cleanup-job slår vinduet op pr. virksomhed.
create or replace function public.retention_days(p_company_id uuid, p_category text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null
     and not public.is_platform_admin()
     and p_company_id is distinct from public.current_company_id()
    then null
    else coalesce(
    case p_category
      when 'parcels'       then cr.parcels_days
      when 'parcel_files'  then cr.parcel_files_days
      when 'notifications' then cr.notifications_days
      when 'audit'         then cr.audit_days
      when 'imports'       then cr.imports_days
      when 'asset_loans'   then cr.asset_loans_days
      when 'employees'     then cr.employees_days
      when 'routes'        then cr.routes_days
    end,
    case p_category
      when 'parcels'       then ps.parcels_retention_days
      when 'parcel_files'  then ps.parcel_files_retention_days
      when 'notifications' then ps.notifications_retention_days
      when 'audit'         then ps.audit_retention_days
      when 'imports'       then ps.import_retention_days
      when 'asset_loans'   then ps.asset_loans_retention_days
      when 'employees'     then ps.employees_retention_days
      when 'routes'        then ps.routes_retention_days
    end)
  end
  from public.platform_settings ps
  left join public.company_retention cr on cr.company_id = p_company_id
  where ps.id;
$$;

revoke execute on function public.retention_days(uuid, text) from public, anon;
grant execute on function public.retention_days(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Beskedloggens modtager ryddes, når pakken er lukket.
--    parcel_notifications.recipient er den bogstavelige e-mail/mobil på hver
--    eneste besked. Udlånenes tvilling (asset_loan_notifications) ryddes
--    allerede ved retur (20260720130100); pakkerne manglede det samme.
--    Selve rækken bevares som dokumentation for AT der blev underrettet —
--    kun adressen fjernes, og status/kanal/tidspunkt står tilbage.
-- ---------------------------------------------------------------------------
create or replace function public.clear_notification_recipients()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('delivered', 'rejected', 'returned', 'removed')
     and old.status is distinct from new.status then
    update public.parcel_notifications
      set recipient = null
      where parcel_id = new.id and recipient is not null;
  end if;
  return new;
end;
$$;

create trigger parcels_clear_notification_recipients
  after update of status on public.parcels
  for each row execute function public.clear_notification_recipients();

-- Historikken: ryd modtageren på alle allerede lukkede pakker.
update public.parcel_notifications n
  set recipient = null
  from public.parcels p
  where p.id = n.parcel_id
    and n.recipient is not null
    and p.status in ('delivered', 'rejected', 'returned', 'removed');

-- ---------------------------------------------------------------------------
-- 6. Purge-funktionen, nu pr. kunde og pr. kategori.
--
--    Rækkefølgen inde i en kunde er ikke ligegyldig: pakkefiler og
--    beskedrækker hænger på pakken, og parcel_events har
--    'on delete restrict' mod parcels (historikken beskytter sig selv mod
--    kaskader). Hændelserne slettes derfor eksplicit FØR pakken — begge dele
--    er kun mulige, fordi GUC'en operia.retention_purge er sat.
-- ---------------------------------------------------------------------------
create or replace function public.run_retention_purge()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  emp record;
  d integer;
  n bigint;
  v_platform_audit integer;
  v_ids uuid[];
begin
  -- Transaktionslokal (is_local => true): åbner block_mutation for denne purge.
  perform set_config('operia.retention_purge', 'on', true);

  select audit_retention_days into v_platform_audit from platform_settings where id;

  -- Platform-egne revisionsrækker (company_id is null) hører ingen kunde til og
  -- følger derfor platformens eget vindue.
  if v_platform_audit is not null then
    delete from audit_log
      where company_id is null
        and created_at < now() - make_interval(days => v_platform_audit);
    get diagnostics n = row_count;
    if n > 0 then
      perform record_audit(null, 'retention.purged', 'audit_log', 'platform', n::text,
        jsonb_build_object('table', 'audit_log', 'scope', 'platform', 'deleted', n,
          'retention_days', v_platform_audit));
    end if;
  end if;

  for c in select id from companies loop
    -- --- Revisionslog ---------------------------------------------------
    d := retention_days(c.id, 'audit');
    if d is not null then
      delete from audit_log
        where company_id = c.id and created_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'audit_log', c.id::text, null,
          jsonb_build_object('table', 'audit_log', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Import ----------------------------------------------------------
    d := retention_days(c.id, 'imports');
    if d is not null then
      delete from import_runs
        where company_id = c.id and created_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'import_run', c.id::text, null,
          jsonb_build_object('table', 'import_runs', 'deleted', n, 'retention_days', d));
      end if;

      delete from inbound_files
        where company_id = c.id and received_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'inbound_file', c.id::text, null,
          jsonb_build_object('table', 'inbound_files', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Beskedlog --------------------------------------------------------
    d := retention_days(c.id, 'notifications');
    if d is not null then
      delete from parcel_notifications
        where company_id = c.id and created_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'parcel_notification', c.id::text, null,
          jsonb_build_object('table', 'parcel_notifications', 'deleted', n, 'retention_days', d));
      end if;

      delete from asset_loan_notifications
        where company_id = c.id and created_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'asset_loan_notification', c.id::text, null,
          jsonb_build_object('table', 'asset_loan_notifications', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Pakker (kun LUKKEDE) --------------------------------------------
    -- En åben eller omtvistet pakke slettes aldrig af et vindue: den er stadig
    -- under behandling, og dokumentationen skal bestå. Lukketidspunktet er
    -- udleverings- eller annulleringstidspunktet, ellers sidste ændring.
    d := retention_days(c.id, 'parcels');
    if d is not null then
      select array_agg(id) into v_ids
        from parcels
        where company_id = c.id
          and status in ('delivered', 'rejected', 'returned', 'removed')
          and coalesce(delivered_at, removed_at, updated_at) < now() - make_interval(days => d);

      if v_ids is not null and array_length(v_ids, 1) > 0 then
        -- Historikken først (FK'en er 'restrict'), derefter pakken. Fotos og
        -- underskrifter i Storage bliver forældreløse og fjernes af det
        -- daglige parcel-files-cleanup-job, som rydder forældreløse filer
        -- uanset vindue.
        delete from parcel_events where parcel_id = any(v_ids);
        delete from parcels where id = any(v_ids);
        get diagnostics n = row_count;
        perform record_audit(c.id, 'retention.purged', 'parcel', c.id::text, null,
          jsonb_build_object('table', 'parcels', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Udlånshistorik ---------------------------------------------------
    -- Låntagerens kontaktoplysninger er ryddet ved retur; her fjernes selve
    -- historikken efter vinduet. Aktive udlån røres ikke.
    d := retention_days(c.id, 'asset_loans');
    if d is not null then
      delete from asset_loans
        where company_id = c.id
          and returned_at is not null
          and returned_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'asset_loan', c.id::text, null,
          jsonb_build_object('table', 'asset_loans', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Ruteplaner -------------------------------------------------------
    d := retention_days(c.id, 'routes');
    if d is not null then
      delete from routes
        where company_id = c.id and updated_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'route', c.id::text, null,
          jsonb_build_object('table', 'routes', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Fratrådte medarbejdere ------------------------------------------
    -- ANONYMISERES, slettes ikke: pakkehistorikken peger på rækken. Kun
    -- inaktive uden åbne pakker, og aldrig én der allerede er anonymiseret.
    d := retention_days(c.id, 'employees');
    if d is not null then
      n := 0;
      for emp in
        select e.id
          from employees e
          where e.company_id = c.id
            and e.is_active = false
            and e.anonymized_at is null
            and coalesce(e.retired_at, e.updated_at) < now() - make_interval(days => d)
            and not public.employee_has_open_parcels(e.id)
      loop
        perform public.anonymize_employee_internal(emp.id, 'Anonymiseret (opbevaringsperiode)');
        n := n + 1;
      end loop;
      if n > 0 then
        perform record_audit(c.id, 'retention.anonymized', 'employee', c.id::text, null,
          jsonb_build_object('table', 'employees', 'anonymized', n, 'retention_days', d));
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.run_retention_purge() from public, anon, authenticated;

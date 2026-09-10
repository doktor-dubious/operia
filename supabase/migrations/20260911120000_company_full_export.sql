-- Samlet kundeudtræk ved ophør (EVU-krav F-08).
--
-- Kunden skal ved ophør kunne få sine data udleveret "i et almindeligt
-- anvendeligt format". Indtil nu fandtes kun stykvise udtræk: medarbejdere,
-- aktiver, lager og bookinger hver for sig, og indsigtsudtrækket pr. person.
-- Ingen af dem svarer på "giv mig alt vores".
--
-- Tre funktioner, fordi et helt udtræk ikke kan hentes i ét svar:
--   catalog()  — hvad der overhovedet kan udleveres, og under hvilken gruppe.
--                Hvidlisten er DENNE liste; klienten kan ikke navngive en tabel,
--                der ikke står her, og en ny tabel udleveres først, når nogen
--                bevidst føjer den til.
--   manifest() — rækketal pr. tabel, så dialogen kan sige hvad pakken indeholder,
--                FØR den hentes, og så modtageren bagefter kan kontrollere, at
--                filen er komplet.
--   rows()     — én side ad gangen, nøglesat på id. Et pakkespor med 200.000
--                hændelser skal ikke gennem PostgREST i ét stykke.
--
-- Hvad der IKKE kommer med:
--   * Hemmelighederne (company_*_secret, slack_oauth_state). De er adgangsnøgler
--     til kundens andre systemer, ikke kundens data, og en nøgle i en CSV-fil er
--     en nøgle på afveje. De to tilsvarende felter, der ligger i almindelige
--     tabeller — carrier_agreements.api_key og log_drains.secret — maskeres.
--   * Filernes indhold. parcel_documents/asset_documents/inbound_files udleveres
--     som deres sti og metadata; selve billederne og dokumenterne ligger i
--     Storage og hentes som et særskilt skridt. Manifestet siger det eksplicit,
--     så ingen tror pakken er komplet, når den ikke er.
--
-- Udtrækket LÆSER kun, men logges (privacy.full_export, niveau warning): en
-- kopi af en hel virksomheds data er den mest vidtgående udlevering systemet
-- kan foretage, og den skal kunne efterprøves bagefter.

-- ---------------------------------------------------------------------------
-- 1) Hvidlisten
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
    ('booking', 'booking_notifications',       80)
  ) as v(grp, tbl, ord)
$fn$;

comment on function public.company_export_catalog() is
  'Hvidliste over hvad et samlet kundeudtræk (F-08) må indeholde, grupperet efter kerne og produktnøgle.';

-- ---------------------------------------------------------------------------
-- 2) Hvem må trække det
-- ---------------------------------------------------------------------------
-- Platform-admin (DCA leverer pakken ved ophør), eller kundens egen manager /
-- data_manager i PRÆCIS den virksomhed — kunden skal kunne tage sin egen kopi
-- uden at bede leverandøren om lov.
create or replace function public.company_export_allowed(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_platform_admin()
      or (p_company_id = public.current_company_id()
          and (public.has_role('manager') or public.has_role('data_manager')))
$fn$;

-- ---------------------------------------------------------------------------
-- 3) Maskering
-- ---------------------------------------------------------------------------
-- Felter der er adgangsnøgler frem for data. Værdien erstattes af en markør, så
-- modtageren kan SE at feltet fandtes — en kolonne der bare forsvandt, ligner en
-- fejl i udtrækket.
create or replace function public.company_export_mask(p_table text, p_row jsonb)
returns jsonb
language sql
immutable
as $fn$
  select case
    when p_table = 'carrier_agreements' and p_row ? 'api_key' and p_row->>'api_key' is not null
      then jsonb_set(p_row, '{api_key}', '"***"'::jsonb)
    when p_table = 'log_drains' and p_row ? 'secret' and p_row->>'secret' is not null
      then jsonb_set(p_row, '{secret}', '"***"'::jsonb)
    else p_row
  end
$fn$;

-- ---------------------------------------------------------------------------
-- 4) Manifestet
-- ---------------------------------------------------------------------------
create or replace function public.company_export_manifest(
  p_company_id uuid,
  p_groups text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_rec record;
  v_count bigint;
  v_tables jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_company record;
begin
  if not public.company_export_allowed(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select id, name, registration_no, created_at into v_company
  from public.companies where id = p_company_id;
  if not found then
    raise exception 'company_not_found' using errcode = 'P0002';
  end if;

  for v_rec in
    select c.grp, c.tbl, c.ord
    from public.company_export_catalog() c
    where c.grp = any(coalesce(p_groups, '{}'::text[]))
    order by c.grp, c.ord
  loop
    if v_rec.tbl = 'companies' then
      v_count := 1;
    else
      execute format('select count(*) from public.%I where company_id = $1', v_rec.tbl)
        into v_count using p_company_id;
    end if;
    v_total := v_total + v_count;
    -- Kolonnenavnene i tabellens egen rækkefølge. To grunde: en tom tabel skal
    -- stadig give en fil med overskrifter (en fil uden hoved kan ikke skelnes
    -- fra en fejl), og jsonb har ingen kolonneorden — uden denne liste ville
    -- felterne stå i vilkårlig rækkefølge i CSV'en.
    v_tables := v_tables || jsonb_build_object(
      'group', v_rec.grp, 'table', v_rec.tbl, 'rows', v_count,
      'columns', (
        select coalesce(jsonb_agg(c.column_name order by c.ordinal_position), '[]'::jsonb)
        from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = v_rec.tbl
      )
    );
  end loop;

  return jsonb_build_object(
    'generated_at', now(),
    'company', jsonb_build_object(
      'id', v_company.id, 'name', v_company.name,
      'registration_no', v_company.registration_no, 'created_at', v_company.created_at
    ),
    'groups', to_jsonb(coalesce(p_groups, '{}'::text[])),
    'tables', v_tables,
    'total_rows', v_total,
    -- Sandheden om hvad pakken IKKE er. Står i filen, ikke kun på skærmen.
    'excludes', jsonb_build_array(
      'Integrationsnøgler og hemmeligheder (maskeret som ***).',
      'Filernes indhold: dokumenter og fotos udleveres som sti og metadata; selve filerne hentes fra Storage.'
    )
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5) Rækkerne, én side ad gangen
-- ---------------------------------------------------------------------------
-- p_after er sidste id på forrige side (nøglesat paginering). Tabeller uden en
-- id-kolonne er konfigurationstabeller med højst en håndfuld rækker pr.
-- virksomhed; de kommer i én side.
create or replace function public.company_export_rows(
  p_company_id uuid,
  p_table text,
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
  v_has_id boolean;
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

  if p_table = 'companies' then
    return query
      select public.company_export_mask('companies', to_jsonb(t))
      from public.companies t where t.id = p_company_id;
    return;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = 'id'
  ) into v_has_id;

  if v_has_id then
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
-- 6) Sporet
-- ---------------------------------------------------------------------------
create or replace function public.log_company_export(
  p_company_id uuid,
  p_groups text[],
  p_tables integer,
  p_rows integer
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_groups text[];
begin
  if not public.company_export_allowed(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Gruppenavnene hvidlistes, præcis som eksportens tabelnavne: loggen er
  -- uforanderlig og videresendes til kundens log drains, så intet af det, en
  -- klient har skrevet frit, må lande i den.
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
      'groups', to_jsonb(v_groups),
      'tables', greatest(coalesce(p_tables, 0), 0),
      'rows', greatest(coalesce(p_rows, 0), 0)
    )
  );
end;
$fn$;

revoke all on function public.company_export_catalog() from public;
revoke all on function public.company_export_allowed(uuid) from public;
revoke all on function public.company_export_mask(text, jsonb) from public;
revoke all on function public.company_export_manifest(uuid, text[]) from public;
revoke all on function public.company_export_rows(uuid, text, text, integer) from public;
revoke all on function public.log_company_export(uuid, text[], integer, integer) from public;

grant execute on function public.company_export_catalog() to authenticated;
grant execute on function public.company_export_allowed(uuid) to authenticated;
grant execute on function public.company_export_manifest(uuid, text[]) to authenticated;
grant execute on function public.company_export_rows(uuid, text, text, integer) to authenticated;
grant execute on function public.log_company_export(uuid, text[], integer, integer) to authenticated;

-- Et helt kundeudtræk skal springe i øjnene i loggen, på linje med
-- user.impersonated. `default null` på p_detail bevares — se
-- 20260908090000: audit_level genskrives af flere migrationer, og en
-- manglende default brækker de kald der kun sender handlingen.
create or replace function public.audit_level(p_action text, p_detail jsonb default null)
returns text language sql immutable as $fn$
  select case
    when p_action = 'ai.label_read' then
      case
        when coalesce(p_detail->>'outcome', '') = 'ok' then 'success'
        when coalesce(p_detail->>'outcome', '') in (
          'integration_disabled', 'not_configured', 'not_allowed', 'not_accepted',
          'model_no_vision', 'forbidden', 'refused', 'image_too_large',
          'unsupported_media_type', 'rate_limited'
        ) then 'warning'
        else 'error'
      end
    when p_action = 'auth.password_reset_requested'
      and coalesce(p_detail->>'email_sent', '') = 'false' then 'error'
    when p_action = 'ai.disclosure_withdrawn' then 'warning'
    when p_action = 'parcel.removed'
      or p_action like '%.failed' or p_action like '%\_failed' escape '\'
      or p_action like '%.bounced' or p_action like '%\_bounced' escape '\'
      or p_action = 'data_transfer.spoof_rejected'
      then 'error'
    when p_action = 'import.rejected'
      or p_action = 'user.impersonated'
      or p_action = 'privacy.full_export'
      or p_action like '%.deleted' or p_action like '%\_deleted' escape '\'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or p_action like '%.written\_off' escape '\'
      or p_action like '%.overridden' or p_action like '%\_overridden' escape '\'
      or p_action like '%.complained' or p_action like '%\_complained' escape '\'
      or p_action like '%.cleared' or p_action like '%\_cleared' escape '\'
      or p_action like '%\_deferred' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned', 'removed'))
      then 'warning'
    else 'success'
  end
$fn$;

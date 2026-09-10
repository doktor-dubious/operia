-- Fixtures for prislisten (EVU-krav C-05).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/booking_tariffs.sql

\set ON_ERROR_STOP on
begin;

select id as cid from public.companies order by created_at limit 1 \gset
select id as rid from public.booking_resources where company_id = :'cid' limit 1 \gset
select set_config('operia.t_cid', :'cid', true) as _;
select set_config('operia.t_rid', :'rid', true) as _;

-- 1) To takster med samme enhed må ikke overlappe i tid.
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid;
        rid uuid := current_setting('operia.t_rid')::uuid;
begin
  insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount, valid_from, valid_to)
  values (cid, 'resource', rid, 'day', 1200, date '2026-01-01', date '2026-06-30');
  begin
    insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount, valid_from, valid_to)
    values (cid, 'resource', rid, 'day', 1400, date '2026-06-01', null);
    raise exception 'FEJL: overlappende takster blev accepteret';
  exception when exclusion_violation then
    raise notice '1 ok: overlap afvist af basen';
  end;
end $$;

-- 2) Forskellige enheder MÅ gælde samtidig (C-07: lokale pr. dag + pr. kursist).
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid;
        rid uuid := current_setting('operia.t_rid')::uuid;
begin
  insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount, valid_from)
  values (cid, 'resource', rid, 'person_day', 185, date '2026-01-01');
  raise notice '2 ok: dagspris og personpris kan gælde samtidig';
end $$;

-- 3) Opslaget svarer på "hvad kostede det DEN dag", ikke "hvad koster det nu".
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid;
        rid uuid := current_setting('operia.t_rid')::uuid;
        v numeric;
begin
  insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount, valid_from)
  values (cid, 'resource', rid, 'day', 1400, date '2026-07-01');

  select amount into v from public.booking_tariffs_on(cid, rid, date '2026-03-15') where unit = 'day';
  if v <> 1200 then raise exception 'FEJL: marts gav % (ventede 1200)', v; end if;

  select amount into v from public.booking_tariffs_on(cid, rid, date '2026-11-15') where unit = 'day';
  if v <> 1400 then raise exception 'FEJL: november gav % (ventede 1400)', v; end if;

  if exists (select 1 from public.booking_tariffs_on(cid, rid, date '2025-12-31')) then
    raise exception 'FEJL: en dato før første takst gav en pris';
  end if;
  raise notice '3 ok: prisen følger datoen (marts 1200, november 1400, 2025 ingen)';
end $$;

-- 4) En takst kan ikke hænges på en anden virksomheds ressource.
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid;
        other_res uuid;
begin
  select id into other_res from public.booking_resources where company_id <> cid limit 1;
  if other_res is null then
    raise notice '4 sprunget over: kun én virksomhed har ressourcer';
    return;
  end if;
  begin
    insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount)
    values (cid, 'resource', other_res, 'day', 100);
    raise exception 'FEJL: fremmed ressource blev accepteret';
  exception when sqlstate 'P0001' then
    raise notice '4 ok: fremmed ressource afvist';
  end;
end $$;

-- 5) Scope og mål skal stemme.
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid;
        rid uuid := current_setting('operia.t_rid')::uuid;
begin
  begin
    insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount)
    values (cid, 'service', rid, 'day', 100);
    raise exception 'FEJL: scope=service med resource_id blev accepteret';
  exception when check_violation then
    raise notice '5 ok: scope og mål skal stemme';
  end;
end $$;

-- 6) Ændringer havner i sporet.
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid;
        n int;
begin
  select count(*) into n from public.audit_log
   where company_id = cid and action like 'booking_tariff.%';
  if n < 3 then
    raise exception 'FEJL: ventede mindst 3 takst-hændelser i sporet, fandt %', n;
  end if;
  raise notice '6 ok: % takst-hændelser i sporet', n;
end $$;

rollback;

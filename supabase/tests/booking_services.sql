-- Fixtures for tilkøbsydelser (20260909120000_booking_services.sql, EVU-krav A-06).
--
-- Kan køres mod den lokale stak ELLER mod projektet — alt sker i én
-- transaktion, der rulles tilbage til sidst:
--   PGPASSWORD=$SUPABASE_DB_PASSWORD psql "host=aws-0-eu-north-1.pooler.supabase.com \
--     port=5432 user=postgres.rjlxmdfmktucunxehtqz dbname=postgres sslmode=require" \
--     -f supabase/tests/booking_services.sql
--
-- Det testen skal fange, hvis nogen ændrer i logikken senere:
--   1) Ydelser tilføjes fra kataloget med antal og pris (selve kravet).
--   2) Prisen SNAPSHOTTES: en senere prisændring rammer ikke linjen (C-05).
--   3) Samme ydelse kan ikke ligge to gange — antallet er multiplikatoren.
--   4) En deaktiveret ydelse kan ikke tilføjes.
--   5) Tenant-grænsen: en ydelse fra en anden virksomhed afvises.
--   6) Antallet valideres, og en ydelse uden antal tvinges til 1.
--   7) Låsen: en faktureret booking kan ikke få flere linjer (A-02/A-03).
--   8) En ydelse i brug kan ikke slettes (FK 'restrict').

begin;

\set QUIET on
\pset footer off

create temporary table t as
select
  '11111111-1111-1111-1111-111111111111'::uuid as company_id,
  (select au.user_id from public.app_users au
     join auth.users u on u.id = au.user_id
    where au.company_id = '11111111-1111-1111-1111-111111111111'
      and u.email = 'rfs@skardhamar.com') as manager_user,
  (select id from public.employees
    where company_id = '11111111-1111-1111-1111-111111111111'
      and is_active order by created_at limit 1) as employee_id,
  (select id from public.companies
    where id <> '11111111-1111-1111-1111-111111111111' order by created_at limit 1) as other_company;

insert into public.booking_resources (company_id, name)
select company_id, 'TEST ydelser' from t;

create temporary table r as select id from public.booking_resources where name = 'TEST ydelser';

insert into public.booking_services (company_id, name, has_quantity, price_mode, unit_price)
select company_id, 'TEST Forplejning', true, 'unit', 195.00 from t;
insert into public.booking_services (company_id, name, has_quantity, price_mode, unit_price)
select company_id, 'TEST Rengøring', false, 'total', 750.00 from t;
insert into public.booking_services (company_id, name, has_quantity, price_mode, unit_price, is_active)
select company_id, 'TEST Udgået', true, 'unit', 50.00, false from t;
insert into public.booking_services (company_id, name)
select other_company, 'TEST Fremmed ydelse' from t;

create temporary table s as
select
  (select id from public.booking_services where name = 'TEST Forplejning') as food,
  (select id from public.booking_services where name = 'TEST Rengøring') as clean,
  (select id from public.booking_services where name = 'TEST Udgået') as gone,
  (select id from public.booking_services where name = 'TEST Fremmed ydelse') as foreign_svc;

select set_config('request.jwt.claims',
  json_build_object('sub', (select manager_user from t))::text, true);

create temporary table b as
select public.create_booking(
  (select id from r), (select employee_id from t),
  now() + interval '7 days', now() + interval '7 days 6 hours', 'Kursus') as id;

\echo ''
\echo '=== 1) Ydelser tilføjes med antal og pris ==================================='
select public.add_booking_service((select id from b), (select food from s), 18);
select public.add_booking_service((select id from b), (select clean from s), 99);
select sv.name, l.quantity, l.unit_price, l.price_mode,
       case when l.price_mode = 'unit' then l.quantity * l.unit_price else l.unit_price end as linjebeloeb
from public.booking_service_lines l join public.booking_services sv on sv.id = l.service_id
where l.booking_id = (select id from b) order by sv.name;

\echo ''
\echo '=== 2) Prissnapshot: en senere prisændring rammer ikke linjen (C-05) ========'
update public.booking_services set unit_price = 250.00 where id = (select food from s);
select case when l.unit_price = 195.00 then 'linjen beholdt 195,00' else 'FEJL: linjen fulgte med' end as status
from public.booking_service_lines l where l.service_id = (select food from s);

\echo ''
\echo '=== 3) Samme ydelse kan ikke ligge to gange ================================='
do $$ begin
  perform public.add_booking_service((select id from b), (select food from s), 4);
  raise notice 'FEJL: dublet blev accepteret';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 4) En deaktiveret ydelse kan ikke tilføjes =============================='
do $$ begin
  perform public.add_booking_service((select id from b), (select gone from s), 1);
  raise notice 'FEJL: deaktiveret ydelse blev tilføjet';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 5) Tenant-grænsen ======================================================'
do $$ begin
  perform public.add_booking_service((select id from b), (select foreign_svc from s), 1);
  raise notice 'FEJL: fremmed ydelse blev tilføjet';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 6) Antal: valideres, og en ydelse uden antal tvinges til 1 =============='
select case when quantity = 1 then 'rengøring lagt som antal 1' else 'FEJL: antal ' || quantity end as status
from public.booking_service_lines where service_id = (select clean from s);
do $$
declare v_line uuid;
begin
  select id into v_line from public.booking_service_lines where service_id = (select food from s);
  perform public.update_booking_service(v_line, 0);
  raise notice 'FEJL: antal 0 blev accepteret';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 7) Låsen: en faktureret booking kan ikke få flere linjer ================'
update public.bookings set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day'
 where id = (select id from b);
select public.set_booking_invoiced((select id from b));
do $$
declare v_line uuid;
begin
  select id into v_line from public.booking_service_lines where service_id = (select food from s);
  perform public.update_booking_service(v_line, 20);
  raise notice 'FEJL: linjen kunne rettes efter fakturering';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 8) En ydelse i brug kan ikke slettes ===================================='
do $$ begin
  delete from public.booking_services where id = (select food from s);
  raise notice 'FEJL: en ydelse i brug blev slettet';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 9) Sporet: hændelser og revisionslog ==================================='
select event_type from public.booking_events where booking_id = (select id from b) order by id;
select action, level from public.audit_log
where entity_type in ('booking','booking_service') and created_at > now() - interval '1 minute'
order by created_at;

rollback;

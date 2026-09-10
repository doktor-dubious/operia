-- Fixtures for revisionssporet ved booking-eksport
-- (20260910120000_booking_export_audit.sql, EVU-krav B-01).
--
-- Kan køres mod den lokale stak ELLER mod projektet — alt sker i én
-- transaktion, der rulles tilbage til sidst:
--   PGPASSWORD=$SUPABASE_DB_PASSWORD psql "host=aws-0-eu-north-1.pooler.supabase.com \
--     port=5432 user=postgres.rjlxmdfmktucunxehtqz dbname=postgres sslmode=require" \
--     -f supabase/tests/booking_export.sql
--
-- Det testen skal fange, hvis nogen ændrer i logikken senere:
--   1) Rettighedsgrænsen: en booking_handler kan ikke logge (og dermed ikke
--      bruge den vej, UI'et tilbyder).
--   2) Sporet skrives med bruger, antal rækker, udsnit og kolonner.
--   3) Fri tekst fra klienten slipper IKKE ind i den uforanderlige log: ukendte
--      værdier bliver til 'other'. Den første udgave nøjedes med at forkorte
--      dem, og teksten slap igennem — se 20260910130000.

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
  (select au.user_id from public.app_users au
     join auth.users u on u.id = au.user_id
    where au.company_id = '11111111-1111-1111-1111-111111111111'
      and u.email = 'terminal@dcademo.dk') as handler_user;

insert into public.user_roles (user_id, role)
select handler_user, 'booking_handler' from t on conflict do nothing;

\echo ''
\echo '=== 1) En booking_handler kan ikke logge en eksport ========================='
select set_config('request.jwt.claims',
  json_build_object('sub', (select handler_user from t))::text, true);
do $$ begin
  perform public.log_booking_export((select company_id from t), 'filtered', 12, '{}'::jsonb);
  raise notice 'FEJL: en booking_handler kunne logge';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 2) Manageren logger — bruger, antal, udsnit og kolonner ================='
select set_config('request.jwt.claims',
  json_build_object('sub', (select manager_user from t))::text, true);
select public.log_booking_export(
  (select company_id from t), 'filtered', 42,
  jsonb_build_object('shape', 'bookings', 'profile', 'operia',
                     'columns', jsonb_build_array('booking_id', 'resource', 'employee')));

select a.action, a.level, a.summary,
       a.detail->>'scope' as udsnit, a.detail->>'rows' as raekker,
       a.detail->>'shape' as form, a.detail->'columns' as kolonner,
       a.actor_user_id = (select manager_user from t) as af_manageren
from public.audit_log a
where a.action = 'booking.exported' and a.company_id = (select company_id from t)
order by a.id desc limit 1;

\echo ''
\echo '=== 3) Fri tekst fra klienten slipper ikke ind i loggen ====================='
-- Klienten forsøger at smugle et bookingformål og et navn med.
select public.log_booking_export(
  (select company_id from t), 'Møde med Anna om fratrædelse', 1,
  jsonb_build_object('shape', 'Anna Bech Clausen', 'profile', 'x',
                     'secret', 'må ikke gemmes',
                     'columns', jsonb_build_array('booking_id')));

select case when a.detail::text like '%fratrædelse%' or a.detail::text like '%Anna%'
            then 'FEJL: fritekst i loggen' else 'ingen fritekst' end as fritekst,
       case when a.detail ? 'secret' then 'FEJL: ukendt felt gemt'
            else 'ukendte felter droppet' end as felter_ok,
       a.detail->>'scope' as udsnit, a.detail->>'shape' as form,
       a.detail->>'profile' as profil
from public.audit_log a
where a.action = 'booking.exported' and a.company_id = (select company_id from t)
order by a.id desc limit 1;

rollback;

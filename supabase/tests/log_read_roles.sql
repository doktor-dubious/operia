-- Fixtures for læseadgangen til loggene (20260910220000_log_read_roles.sql,
-- EVU-krav D-03/F-01).
--
-- Kan køres mod den lokale stak ELLER mod projektet — alt sker i én
-- transaktion, der rulles tilbage til sidst:
--   PGPASSWORD=$SUPABASE_DB_PASSWORD psql "host=aws-0-eu-north-1.pooler.supabase.com \
--     port=5432 user=postgres.rjlxmdfmktucunxehtqz dbname=postgres sslmode=require" \
--     -f supabase/tests/log_read_roles.sql
--
-- Testen SÆTTER rollen til `authenticated` og skifter bruger med
-- request.jwt.claims, så RLS afgør svaret — præcis som gennem API'et.
--
-- Det testen skal fange, hvis nogen ændrer i politikkerne senere:
--   1) En håndterer kan ikke længere læse ændringsloggen.
--   2) En booking_manager kan.
--   3) Revisionsloggen er åben for ansvarsrollerne, ikke for håndtererne —
--      aktiv- og lagerimportens logsider læser den under deres egen rolle.
--   4) Tenant-grænsen står stadig: en anden virksomheds rækker er usynlige.

begin;

\set QUIET on
\pset footer off

-- Sikr at der ER noget at læse, og at brugerne har de roller testen antager.
insert into public.user_roles (user_id, role)
select au.user_id, 'booking_handler'
from public.app_users au join auth.users u on u.id = au.user_id
where u.email = 'terminal@dcademo.dk'
on conflict do nothing;

select set_config('request.jwt.claims',
  json_build_object('sub', (select au.user_id from public.app_users au
    join auth.users u on u.id = au.user_id where u.email = 'rfs@skardhamar.com'))::text, true);

insert into public.booking_resources (company_id, name)
values ('11111111-1111-1111-1111-111111111111', 'TEST læserettigheder');
create temporary table b as
select public.create_booking(
  (select id from public.booking_resources where name = 'TEST læserettigheder'),
  (select id from public.employees where company_id = '11111111-1111-1111-1111-111111111111'
     and is_active order by created_at limit 1),
  now() + interval '8 days', now() + interval '8 days 2 hours', 'Læsetest') as id;

-- Brugerid'erne slås op FØR rolleskiftet og lægges i psql-variable: bagefter
-- er hverken auth.users eller app_users læsbare for rollen authenticated, og
-- opslaget ville i sig selv afhænge af de claims, vi er ved at sætte.
select
  (select au.user_id from public.app_users au join auth.users u on u.id = au.user_id
    where u.email = 'rfs@skardhamar.com') as mgr,
  (select au.user_id from public.app_users au join auth.users u on u.id = au.user_id
    where u.email = 'terminal@dcademo.dk') as hdl
\gset

set local role authenticated;

\echo ''
\echo '=== 1) En booking_handler kan ikke læse ændringsloggen ======================'
select set_config('request.jwt.claims', json_build_object('sub', :'hdl')::text, true);
select count(*) as synlige_haendelser from public.booking_events;

\echo ''
\echo '=== 2) En manager/booking_manager kan ======================================='
select set_config('request.jwt.claims', json_build_object('sub', :'mgr')::text, true);
select count(*) > 0 as ser_haendelser from public.booking_events;

\echo ''
\echo '=== 3) Revisionsloggen: håndterer nej, ansvarlig ja ========================='
select set_config('request.jwt.claims', json_build_object('sub', :'hdl')::text, true);
select count(*) as handterer_ser from public.audit_log;
select set_config('request.jwt.claims', json_build_object('sub', :'mgr')::text, true);
select count(*) > 0 as ansvarlig_ser from public.audit_log;

\echo ''
\echo '=== 4) Tenant-grænsen står stadig ==========================================='
select count(*) as fremmede_raekker from public.booking_events
where company_id <> '11111111-1111-1111-1111-111111111111';

reset role;
rollback;

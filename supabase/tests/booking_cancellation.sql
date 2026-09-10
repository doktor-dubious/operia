-- Fixtures for afbestilling med årsag (20260909090000_booking_cancellation_reason.sql,
-- EVU-krav A-07).
--
-- Kan køres mod den lokale stak ELLER mod projektet — alt sker i én
-- transaktion, der rulles tilbage til sidst:
--   PGPASSWORD=$SUPABASE_DB_PASSWORD psql "host=aws-0-eu-north-1.pooler.supabase.com \
--     port=5432 user=postgres.rjlxmdfmktucunxehtqz dbname=postgres sslmode=require" \
--     -f supabase/tests/booking_cancellation.sql
--
-- Det testen skal fange, hvis nogen ændrer i logikken senere:
--   1) Rettighedsgrænsen: en booking_handler kan IKKE længere afbestille.
--   2) Årsagen er påkrævet — også når klienten sender mellemrum.
--   3) De tre led i kravet registreres: tidspunkt, ansvarlig og årsag.
--   4) Handlingen står i ændringsloggen — men årsagens FRITEKST gør ikke,
--      fordi audit_log er uforanderlig og videresendes til log drains.
--   5) Bookingen udgår af dobbeltbookingsværnet, dvs. tidsrummet er ledigt igen
--      ("udgår af fakturagrundlaget" kan først vises, når C-01 findes).
--   6) En faktureret booking kan stadig ikke afbestilles (kræver kreditnota).

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
      and u.email = 'terminal@dcademo.dk') as handler_user,
  (select id from public.employees
    where company_id = '11111111-1111-1111-1111-111111111111'
      and is_active order by created_at limit 1) as employee_id;

insert into public.booking_resources (company_id, name)
select company_id, 'TEST afbestilling' from t;

create temporary table r as
select id from public.booking_resources where name = 'TEST afbestilling';

-- Handler-brugeren får KUN booking_handler, så grænsen kan prøves.
insert into public.user_roles (user_id, role)
select handler_user, 'booking_handler' from t
on conflict do nothing;

select set_config('request.jwt.claims',
  json_build_object('sub', (select manager_user from t))::text, true);

create temporary table b as
select public.create_booking(
  (select id from r), (select employee_id from t),
  now() + interval '5 days', now() + interval '5 days 2 hours', 'Kursus') as id;

\echo ''
\echo '=== 1) En booking_handler må ikke afbestille ================================'
select set_config('request.jwt.claims',
  json_build_object('sub', (select handler_user from t))::text, true);
do $$ begin
  perform public.cancel_booking((select id from b), 'Handler forsøger');
  raise notice 'FEJL: en booking_handler kunne afbestille';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 2) Årsagen er påkrævet — også når den kun er mellemrum =================='
select set_config('request.jwt.claims',
  json_build_object('sub', (select manager_user from t))::text, true);
do $$ begin
  perform public.cancel_booking((select id from b), '   ');
  raise notice 'FEJL: tom årsag blev accepteret';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 3) Tidspunkt, ansvarlig og årsag registreres ============================'
select public.cancel_booking((select id from b), 'For få tilmeldte');
select status,
       case when cancelled_at is not null then 'tidspunkt sat' else 'FEJL' end as tid,
       case when cancelled_by = (select manager_user from t) then 'ansvarlig sat' else 'FEJL' end as hvem,
       cancellation_reason as aarsag
from public.bookings where id = (select id from b);

\echo ''
\echo '=== 4) Ændringsloggen: handlingen står der, fritekst gør ikke ==============='
select e.event_type, e.detail ? 'has_reason' as markeret,
       (e.detail::text like '%tilmeldte%') as fritekst_laekket
from public.booking_events e where e.booking_id = (select id from b) order by e.id;

select a.action, a.level, (a.detail::text like '%tilmeldte%') as fritekst_laekket
from public.audit_log a
where a.entity_type = 'booking' and a.entity_id = (select id from b)::text
order by a.created_at;

\echo ''
\echo '=== 5) Tidsrummet er ledigt igen ==========================================='
do $$ begin
  perform public.create_booking(
    (select id from r), (select employee_id from t),
    now() + interval '5 days', now() + interval '5 days 2 hours', 'Ny booking samme tid');
  raise notice 'tidsrummet kunne bookes igen som forventet';
exception when others then raise notice 'FEJL: tidsrummet er stadig spærret: %', sqlerrm; end $$;

\echo ''
\echo '=== 6) En faktureret booking kan ikke afbestilles ==========================='
create temporary table b2 as
select public.create_booking(
  (select id from r), (select employee_id from t),
  now() + interval '9 days', now() + interval '9 days 2 hours', 'Til fakturering') as id;
-- Flyt den til fortiden, så den kan faktureres.
update public.bookings set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day'
 where id = (select id from b2);
select public.set_booking_invoiced((select id from b2));
do $$ begin
  perform public.cancel_booking((select id from b2), 'Fortrudt');
  raise notice 'FEJL: en faktureret booking blev afbestilt';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

rollback;

-- Fixtures for ændringsloggen på databaseniveau
-- (20260910160000_booking_audit_trigger.sql, EVU-krav D-01 og D-02).
--
-- Kan køres mod den lokale stak ELLER mod projektet — alt sker i én
-- transaktion, der rulles tilbage til sidst:
--   PGPASSWORD=$SUPABASE_DB_PASSWORD psql "host=aws-0-eu-north-1.pooler.supabase.com \
--     port=5432 user=postgres.rjlxmdfmktucunxehtqz dbname=postgres sslmode=require" \
--     -f supabase/tests/booking_audit_trigger.sql
--
-- Det testen skal fange, hvis nogen ændrer i logikken senere:
--   1) D-02: en ændring UDEN OM RPC'erne (rå SQL, som en service-role eller en
--      migration ville gøre det) logges på nøjagtig samme måde.
--   2) D-01: før/efter dækker nu også de felter, RPC'en aldrig skrev — bl.a.
--      heldags-flaget.
--   3) Ingen dobbelthændelser: RPC'en skriver ikke længere selv.
--   4) Et gem uden ændringer giver ingen hændelse.
--   5) Statusskift og fakturering får deres egne hændelsestyper, udledt af
--      selve rækkeændringen.
--   6) Fritekst (formål, afbestillingsårsag) kommer ALDRIG med i loggen —
--      kun at feltet blev ændret.

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
      and is_active order by created_at limit 1) as employee_id;

insert into public.booking_resources (company_id, name)
select company_id, 'TEST revisionstrigger' from t;
create temporary table r as
select id from public.booking_resources where name = 'TEST revisionstrigger';

select set_config('request.jwt.claims',
  json_build_object('sub', (select manager_user from t))::text, true);

create temporary table b as
select public.create_booking(
  (select id from r), (select employee_id from t),
  now() + interval '4 days', now() + interval '4 days 3 hours',
  'Hemmeligt møde om Anna', false, 12) as id;

\echo ''
\echo '=== 1) Oprettelsen gav ÉN hændelse (ikke to) ================================'
select event_type, count(*) as antal,
       (detail ? 'has_title') as har_titelflag,
       (detail::text like '%Anna%') as fritekst_laekket
from public.booking_events where booking_id = (select id from b)
group by 1, 3, 4;

\echo ''
\echo '=== 2) Et gem uden ændringer giver ingen hændelse ==========================='
select public.update_booking(
  (select id from b), (select id from r), (select employee_id from t),
  (select starts_at from public.bookings where id = (select id from b)),
  (select ends_at from public.bookings where id = (select id from b)),
  'Hemmeligt møde om Anna', false, 12);
select count(*) as haendelser_i_alt from public.booking_events where booking_id = (select id from b);

\echo ''
\echo '=== 3) D-01: heldags-flaget kommer nu med i før/efter ======================='
-- Feltet blev ALDRIG skrevet af RPC'ens gamle hændelse.
select public.update_booking(
  (select id from b), (select id from r), (select employee_id from t),
  date_trunc('day', now() + interval '4 days'),
  date_trunc('day', now() + interval '5 days'),
  'Hemmeligt møde om Anna', true, 12);
select event_type, detail->>'from_all_day' as foer, detail->>'to_all_day' as efter
from public.booking_events
where booking_id = (select id from b) and event_type = 'updated' order by id desc limit 1;

\echo ''
\echo '=== 4) D-02: en ændring UDEN OM RPC''erne logges på samme måde =============='
-- Rå SQL — præcis det en service-role, en migration eller en psql-session gør.
update public.bookings
   set participant_count = 30
 where id = (select id from b);
select event_type, detail->>'from_participant_count' as foer,
       detail->>'to_participant_count' as efter
from public.booking_events
where booking_id = (select id from b) order by id desc limit 1;

\echo ''
\echo '=== 5) Fritekst: kun kendsgerningen, aldrig indholdet ======================='
update public.bookings set title = 'Samtale med Bo om opsigelse'
 where id = (select id from b);
select event_type, detail->>'title_changed' as titel_aendret,
       (detail::text like '%opsigelse%' or detail::text like '%Bo %') as fritekst_laekket
from public.booking_events
where booking_id = (select id from b) order by id desc limit 1;

\echo ''
\echo '=== 6) Statusskift og fakturering får egne hændelsestyper ==================='
update public.bookings
   set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day'
 where id = (select id from b);
select public.set_booking_invoiced((select id from b));
select public.set_booking_invoiced((select id from b), false);
select public.cancel_booking((select id from b), 'Aflyst pga. sygdom');

select event_type, detail->>'has_reason' as har_aarsag,
       (detail::text like '%sygdom%') as fritekst_laekket
from public.booking_events
where booking_id = (select id from b) and event_type in ('invoiced','invoice_cleared','cancelled')
order by id;

\echo ''
\echo '=== 7) Hele sporet, som en revisor ville læse det ==========================='
select e.id, e.event_type, e.actor_user_id = (select manager_user from t) as af_manageren,
       e.detail
from public.booking_events e where e.booking_id = (select id from b) order by e.id;

select a.action, a.level from public.audit_log a
where a.entity_type = 'booking' and a.entity_id = (select id from b)::text order by a.created_at, a.id;

rollback;

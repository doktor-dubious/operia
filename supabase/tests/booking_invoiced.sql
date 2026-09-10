-- Fixtures for bookingens statusmodel booket → i brug → afsluttet → faktureret
-- (20260908090000_booking_invoiced_status.sql, EVU-krav A-02).
--
-- Kan køres mod den lokale stak ELLER mod projektet — alt sker i én
-- transaktion, der rulles tilbage til sidst:
--   PGPASSWORD=$SUPABASE_DB_PASSWORD psql "host=aws-0-eu-north-1.pooler.supabase.com \
--     port=5432 user=postgres.rjlxmdfmktucunxehtqz dbname=postgres sslmode=require" \
--     -f supabase/tests/booking_invoiced.sql
--
-- Brugeren simuleres med request.jwt.claims (det auth.uid() læser), ikke med
-- `set role` — de temporære tabeller nedenfor tilhører postgres og ville være
-- utilgængelige for rollen authenticated. Grants testes derfor ikke her; det er
-- RPC-logikken, fixturen er sat i verden for.
--
-- Det testen skal fange, hvis nogen ændrer i logikken senere:
--   1) Rækkefølgen: kun en AFSLUTTET booking kan faktureres.
--   2) Låsen: en faktureret booking kan hverken rettes (A-03) eller
--      annulleres (kræver kreditnota, C-09).
--   3) Dobbeltbookingsværnet gælder stadig for en faktureret booking — det var
--      hele grunden til ikke at lægge 'invoiced' ind i booking_status-enum'en.
--   4) Rettighedsgrænsen: fakturering er manager/booking_manager, ikke
--      booking_handler.
--   5) Sporet: hændelse + revisionslog, og at det at FJERNE markeringen igen
--      lander på advarselsniveau.

begin;

\set QUIET on
\pset footer off

-- Testvirksomhed: den eneste med bookingressourcer i dag.
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

-- Egen ressource, så vi aldrig støder ind i demodataens bookinger.
insert into public.booking_resources (company_id, name)
select company_id, 'TEST fakturastatus' from t;

create temporary table r as
select id from public.booking_resources where name = 'TEST fakturastatus';

-- Handler-brugeren får booking_handler, så rettighedsgrænsen kan prøves.
insert into public.user_roles (user_id, role)
select handler_user, 'booking_handler' from t
on conflict do nothing;

-- To bookinger: én afsluttet (i går) og én fremtidig (i morgen). Indsat
-- direkte, fordi create_booking med vilje ikke vil lave fortidige bookinger,
-- når kunden har slået retroaktiv booking fra.
insert into public.bookings
  (company_id, resource_id, employee_id, booked_by, starts_at, ends_at, title)
select t.company_id, r.id, t.employee_id, t.manager_user,
       now() - interval '2 days', now() - interval '1 day', 'TEST afsluttet'
from t, r;

insert into public.bookings
  (company_id, resource_id, employee_id, booked_by, starts_at, ends_at, title)
select t.company_id, r.id, t.employee_id, t.manager_user,
       now() + interval '1 day', now() + interval '2 days', 'TEST fremtidig'
from t, r;

create temporary table b as
select
  (select id from public.bookings where title = 'TEST afsluttet') as done_id,
  (select id from public.bookings where title = 'TEST fremtidig') as future_id;

-- Log ind som manageren (som IKKE er platform-admin — grænsen testes reelt).
select set_config('request.jwt.claims',
  json_build_object('sub', (select manager_user from t))::text, true);

\echo ''
\echo '=== 1) Rækkefølgen: en fremtidig booking kan ikke faktureres ================'
do $$ begin
  perform public.set_booking_invoiced((select future_id from b));
  raise notice 'FEJL: kaldet lykkedes — forventede booking_not_completed';
exception when others then
  raise notice 'afvist som forventet: %', sqlerrm;
end $$;

\echo ''
\echo '=== 2) En afsluttet booking kan ============================================='
select public.set_booking_invoiced((select done_id from b));
select case when invoiced_at is not null then 'invoiced_at SAT' else 'FEJL: tom' end as stempel,
       case when invoiced_by = (select manager_user from t) then 'invoiced_by = manageren'
            else 'FEJL: forkert bruger' end as bruger
from public.bookings where id = (select done_id from b);

\echo ''
\echo '=== 3) Låsen: faktureret kan hverken rettes, annulleres eller fak. igen ====='
do $$ begin
  perform public.update_booking(
    (select done_id from b), (select id from r), (select employee_id from t),
    now() - interval '2 days', now() - interval '1 day', 'RETTET');
  raise notice 'FEJL: update_booking lykkedes';
exception when others then raise notice 'update_booking afvist: %', sqlerrm; end $$;

do $$ begin
  perform public.cancel_booking((select done_id from b), 'Test: faktureret booking');
  raise notice 'FEJL: cancel_booking lykkedes';
exception when others then raise notice 'cancel_booking afvist: %', sqlerrm; end $$;

do $$ begin
  perform public.set_booking_invoiced((select done_id from b));
  raise notice 'FEJL: dobbelt fakturering lykkedes';
exception when others then raise notice 'gentagen fakturering afvist: %', sqlerrm; end $$;

\echo ''
\echo '=== 4) Dobbeltbookingsværnet gælder stadig for en faktureret booking ========'
do $$ begin
  perform public.create_booking(
    (select id from r), (select employee_id from t),
    now() - interval '2 days' + interval '1 hour',
    now() - interval '1 day' - interval '1 hour',
    'OVERLAP');
  raise notice 'FEJL: overlappende booking blev oprettet';
exception when others then raise notice 'overlap afvist: %', sqlerrm; end $$;

\echo ''
\echo '=== 5) Rettighedsgrænsen: booking_handler må ikke fakturere ================='
select set_config('request.jwt.claims',
  json_build_object('sub', (select handler_user from t))::text, true);
do $$ begin
  perform public.set_booking_invoiced((select future_id from b));
  raise notice 'FEJL: en booking_handler kunne fakturere';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 6) Fjern markeringen igen — så kan bookingen rettes ====================='
select set_config('request.jwt.claims',
  json_build_object('sub', (select manager_user from t))::text, true);
select public.set_booking_invoiced((select done_id from b), false);
select case when invoiced_at is null and invoiced_by is null then 'markering fjernet'
            else 'FEJL: står stadig' end as status
from public.bookings where id = (select done_id from b);
select public.update_booking(
  (select done_id from b), (select id from r), (select employee_id from t),
  now() - interval '2 days', now() - interval '1 day', 'RETTET EFTER FJERNELSE');
select case when title = 'RETTET EFTER FJERNELSE' then 'rettelse slog igennem'
            else 'FEJL: ikke rettet' end as status
from public.bookings where id = (select done_id from b);

\echo ''
\echo '=== 7) Sporet: hændelser og revisionslog ===================================='
select event_type, actor_user_id = (select manager_user from t) as af_manageren
from public.booking_events
where booking_id = (select done_id from b)
order by id;

select action, level
from public.audit_log
where entity_type = 'booking' and entity_id = (select done_id from b)::text
order by created_at;

rollback;

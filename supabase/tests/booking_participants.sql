-- Fixtures for kursister på bookingen (20260908190000_booking_participants.sql,
-- EVU-krav A-05).
--
-- Kan køres mod den lokale stak ELLER mod projektet — alt sker i én
-- transaktion, der rulles tilbage til sidst:
--   PGPASSWORD=$SUPABASE_DB_PASSWORD psql "host=aws-0-eu-north-1.pooler.supabase.com \
--     port=5432 user=postgres.rjlxmdfmktucunxehtqz dbname=postgres sslmode=require" \
--     -f supabase/tests/booking_participants.sql
--
-- Brugeren simuleres med request.jwt.claims (som i booking_invoiced.sql).
--
-- Det testen skal fange, hvis nogen ændrer i logikken senere:
--   1) Felterne kan udfyldes ved oprettelse og ændres bagefter (selve kravet).
--   2) Tenant-grænsen: et niveau fra en ANDEN virksomhed kan ikke sættes på.
--   3) Et deaktiveret niveau kan ikke VÆLGES, men bliver stående på en booking
--      der allerede har det — ellers ville en rettelse af klokkeslættet tvinge
--      en ændring af fakturagrundlaget.
--   4) Antallet valideres med en maskinlæsbar kode, ikke en rå constraint.
--   5) Et niveau i brug kan ikke slettes (fremmednøglen er 'restrict', så
--      fakturagrundlaget ikke tømmes i det stille).
--   6) C-10: ændringen af deltagerantallet står i hændelsesloggen med før/efter.
--   7) Låsen fra A-02/A-03 gælder også de nye felter.

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
  -- En anden virksomhed at låne et niveau fra i tenant-testen.
  (select id from public.companies
    where id <> '11111111-1111-1111-1111-111111111111' order by created_at limit 1) as other_company;

insert into public.booking_resources (company_id, name)
select company_id, 'TEST kursister' from t;

create temporary table r as
select id from public.booking_resources where name = 'TEST kursister';

insert into public.booking_participant_levels (company_id, name, sort_order)
select company_id, v.n, v.o from t, (values ('TEST Niveau 1', 1), ('TEST Niveau 2', 2)) as v(n, o);

insert into public.booking_participant_levels (company_id, name)
select other_company, 'TEST Fremmed niveau' from t;

create temporary table l as
select
  (select id from public.booking_participant_levels where name = 'TEST Niveau 1') as one,
  (select id from public.booking_participant_levels where name = 'TEST Niveau 2') as two,
  (select id from public.booking_participant_levels where name = 'TEST Fremmed niveau') as foreign_level;

select set_config('request.jwt.claims',
  json_build_object('sub', (select manager_user from t))::text, true);

\echo ''
\echo '=== 1) Felterne udfyldes ved oprettelse ====================================='
create temporary table b as
select public.create_booking(
  (select id from r), (select employee_id from t),
  now() + interval '2 days', now() + interval '2 days 3 hours',
  'Kursus', false, 18, (select one from l)) as id;

select participant_count,
       (select name from public.booking_participant_levels where id = participant_level_id) as niveau
from public.bookings where id = (select id from b);

\echo ''
\echo '=== 2) Tenant-grænsen: et fremmed niveau afvises ============================'
do $$ begin
  perform public.update_booking(
    (select id from b), (select id from r), (select employee_id from t),
    now() + interval '2 days', now() + interval '2 days 3 hours',
    'Kursus', false, 18, (select foreign_level from l));
  raise notice 'FEJL: et niveau fra en anden virksomhed blev accepteret';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 3) Antallet valideres ==================================================='
do $$ begin
  perform public.update_booking(
    (select id from b), (select id from r), (select employee_id from t),
    now() + interval '2 days', now() + interval '2 days 3 hours',
    'Kursus', false, 0, (select one from l));
  raise notice 'FEJL: 0 kursister blev accepteret';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 4) Felterne kan ÆNDRES (kravets andet halvdel) =========================='
select public.update_booking(
  (select id from b), (select id from r), (select employee_id from t),
  now() + interval '2 days', now() + interval '2 days 3 hours',
  'Kursus', false, 24, (select two from l));
select participant_count,
       (select name from public.booking_participant_levels where id = participant_level_id) as niveau
from public.bookings where id = (select id from b);

\echo ''
\echo '=== 5) Deaktiveret niveau: kan ikke vælges, men bliver stående =============='
update public.booking_participant_levels set is_active = false where id = (select two from l);
-- Uændret niveau + ny tid: skal slippe igennem.
select public.update_booking(
  (select id from b), (select id from r), (select employee_id from t),
  now() + interval '3 days', now() + interval '3 days 3 hours',
  'Kursus', false, 24, (select two from l));
select case when participant_level_id = (select two from l) then 'niveauet blev stående'
            else 'FEJL: niveauet forsvandt' end as status
from public.bookings where id = (select id from b);
-- Skift TIL det deaktiverede niveau fra et andet: skal afvises.
do $$ begin
  perform public.update_booking(
    (select id from b), (select id from r), (select employee_id from t),
    now() + interval '3 days', now() + interval '3 days 3 hours',
    'Kursus', false, 24, (select one from l));
  perform public.update_booking(
    (select id from b), (select id from r), (select employee_id from t),
    now() + interval '3 days', now() + interval '3 days 3 hours',
    'Kursus', false, 24, (select two from l));
  raise notice 'FEJL: et deaktiveret niveau kunne vælges';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 6) Et niveau i brug kan ikke slettes ===================================='
-- Bookingen bærer 'two' efter trin 5 (forsøget på at skifte tilbage rullede
-- tilbage i sin egen subtransaktion). 'one' er derimod ubrugt, og at DEN kan
-- slettes hører med til billedet: kun niveauer i brug er beskyttet.
do $$ begin
  delete from public.booking_participant_levels where id = (select two from l);
  raise notice 'FEJL: et niveau i brug blev slettet';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

do $$ begin
  delete from public.booking_participant_levels where id = (select one from l);
  raise notice 'ubrugt niveau slettet som forventet';
exception when others then raise notice 'FEJL: et ubrugt niveau kunne ikke slettes: %', sqlerrm; end $$;

\echo ''
\echo '=== 7) C-10: før/efter på deltagerantallet står i hændelsesloggen ==========='
select detail->>'from_participant_count' as foer, detail->>'to_participant_count' as efter
from public.booking_events
where booking_id = (select id from b) and event_type = 'updated'
order by id;

\echo ''
\echo '=== 8) Låsen: en faktureret booking kan heller ikke få nye kursisttal ======='
-- Bookingen flyttes til fortiden, så den kan faktureres.
update public.bookings
   set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day'
 where id = (select id from b);
select public.set_booking_invoiced((select id from b));
do $$ begin
  perform public.update_booking(
    (select id from b), (select id from r), (select employee_id from t),
    now() - interval '2 days', now() - interval '1 day', 'Kursus', false, 30, null);
  raise notice 'FEJL: kursisttallet kunne rettes efter fakturering';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

rollback;

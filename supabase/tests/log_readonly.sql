-- Fixtures for at loggene er skrivebeskyttede for klientrollerne
-- (20260910180000_log_tables_readonly.sql, EVU-krav D-03).
--
-- Kan køres mod den lokale stak ELLER mod projektet — alt sker i én
-- transaktion, der rulles tilbage til sidst:
--   PGPASSWORD=$SUPABASE_DB_PASSWORD psql "host=aws-0-eu-north-1.pooler.supabase.com \
--     port=5432 user=postgres.rjlxmdfmktucunxehtqz dbname=postgres sslmode=require" \
--     -f supabase/tests/log_readonly.sql
--
-- Testen SÆTTER rollen til `authenticated` og prøver at skrive. Skulle en
-- skrivning mod forventning lykkes, ruller transaktionen den tilbage — men så
-- er der en fejl at rette.
--
-- Det testen skal fange, hvis nogen ændrer i rettighederne senere:
--   1) TRUNCATE på revisionsloggen. Den er den farlige: RLS gælder ikke for
--      TRUNCATE, og immutabilitetstriggeren er en RÆKKEtrigger, som aldrig
--      fyrer — så rettigheden er hele beskyttelsen.
--   2) UPDATE og DELETE på hændelsesloggen.
--   3) INSERT i hændelsesloggen (forfalskede spor).
--   4) DML på beskedloggene, som hverken har skrivepolitik eller trigger.
--   5) Læsning virker stadig.

begin;

\set QUIET on
\pset footer off

set local role authenticated;

\echo ''
\echo '=== 1) TRUNCATE af revisionsloggen ========================================='
do $$ begin
  truncate public.audit_log;
  raise notice 'FEJL: authenticated kunne TØMME revisionsloggen';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 2) UPDATE og DELETE på hændelsesloggen ================================='
do $$ begin
  update public.booking_events set detail = '{}'::jsonb;
  raise notice 'FEJL: hændelser kunne redigeres';
exception when others then raise notice 'update afvist: %', sqlerrm; end $$;

do $$ begin
  delete from public.booking_events;
  raise notice 'FEJL: hændelser kunne slettes';
exception when others then raise notice 'delete afvist: %', sqlerrm; end $$;

\echo ''
\echo '=== 3) INSERT i hændelsesloggen (forfalsket spor) =========================='
do $$ begin
  insert into public.booking_events (booking_id, company_id, event_type, detail)
  values (gen_random_uuid(), gen_random_uuid(), 'created', '{}'::jsonb);
  raise notice 'FEJL: et falsk spor kunne indsættes';
exception when others then raise notice 'afvist som forventet: %', sqlerrm; end $$;

\echo ''
\echo '=== 4) Beskedloggene ======================================================='
do $$ begin
  update public.booking_notifications set status = 'sent';
  raise notice 'FEJL: beskedloggen kunne redigeres';
exception when others then raise notice 'update afvist: %', sqlerrm; end $$;

do $$ begin
  truncate public.parcel_notifications;
  raise notice 'FEJL: beskedloggen kunne tømmes';
exception when others then raise notice 'truncate afvist: %', sqlerrm; end $$;

\echo ''
\echo '=== 5) Læsning virker stadig ==============================================='
-- RLS afgør hvad der kommer med; her er pointen blot, at opslaget ikke afvises.
select 'læsning ok: ' || count(*)::text || ' rækker synlige' from public.audit_log;

reset role;
rollback;

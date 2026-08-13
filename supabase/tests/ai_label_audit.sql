-- Fixtures for AI-label-revisionssporet og kundens bekræftelse
-- (20260812104500_ai_label_read_audit.sql).
--
-- Kan køres mod den lokale stak ELLER mod projektet — alt sker i én
-- transaktion, der rulles tilbage til sidst:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/ai_label_audit.sql
--
-- Det testen skal fange, hvis nogen ændrer i logikken senere:
--   1) Minimering: record_ai_label_read kan IKKE bruges til at skrive fri
--      tekst (og dermed persondata) i den uforanderlige audit_log.
--   2) Beviset: godkendelsen stemples server-side, overlever et urelateret
--      gem, og falder væk når kunden skifter udbyder.
--   3) Sporet: godkendelse og tilbagetrækning bliver til egne audit-hændelser.

begin;

\set QUIET on
\pset footer off

create temporary table t_company (id uuid);
insert into t_company select id from public.companies order by created_at limit 1;

-- Ryd et evt. eksisterende valg for testvirksomheden, så udgangspunktet er kendt.
delete from public.company_ai_config where company_id = (select id from t_company);

\echo ''
\echo '=== 1) Minimering: kun kendte maskinkoder slipper igennem ==================='

-- Første kald: normale værdier. Andet kald: et forsøg på at smugle et navn og
-- en adresse ind i de felter, der ellers ser ud som fri tekst.
select public.record_ai_label_read(
  (select id from t_company), null,
  'anthropic', 'claude-haiku-4-5', 'ok', 'web', 148000, 1234, 9);

select public.record_ai_label_read(
  (select id from t_company), null,
  'Åse Østergård', 'Vestergade 12, 6200 Aabenraa', 'MODTAGER: Åse Østergård',
  'e-mail', -5, -5, 999);

select
  detail->>'provider'     as provider,
  detail->>'model'        as model,
  detail->>'outcome'      as outcome,
  detail->>'source'       as source,
  detail->>'fields_found' as fields,
  summary,
  entity_id,
  -- Skal ALTID være tomt: der findes ingen anden nøgle end de hvidlistede.
  (select string_agg(k, ',' order by k) from jsonb_object_keys(detail) k
    where k not in ('provider','model','outcome','source','image_bytes','duration_ms','fields_found'))
    as ukendte_noegler
from public.audit_log
where action = 'ai.label_read' and company_id = (select id from t_company)
order by id;

\echo '(række 2 skal stå med unknown/unknown/unknown/unknown, felter=99, og tom summary/entity_id)'

\echo ''
\echo '=== 2) Godkendelsen kan kun gives gennem accept_ai_disclosure() ============'

-- En almindelig skrivning må ALDRIG kunne give godkendelsen — heller ikke når
-- den beder pænt om det.
insert into public.company_ai_config (company_id, provider, model, disclosure_accepted)
values ((select id from t_company), 'anthropic', 'claude-haiku-4-5', true);

select disclosure_accepted as via_upsert from public.company_ai_config
where company_id = (select id from t_company);
\echo '(skal stå false: en formular kan ikke afgive en instruks)'

\echo ''
\echo '-- forkert udbyder eller forældet tekstversion afvises --'
-- Savepoints, fordi en fejl ellers ville afbryde hele transaktionen: her er
-- fejlen netop det forventede resultat.
\set ON_ERROR_STOP off
savepoint s1;
select public.accept_ai_disclosure((select id from t_company), 'deepseek', public.ai_disclosure_version());
rollback to savepoint s1;
select public.accept_ai_disclosure((select id from t_company), 'anthropic', '2020-01-01');
rollback to savepoint s1;
\set ON_ERROR_STOP on

\echo ''
\echo '-- den rigtige: udbyder + gældende version --'
select public.accept_ai_disclosure((select id from t_company), 'anthropic', public.ai_disclosure_version());

select disclosure_accepted, disclosure_provider, disclosure_version,
       disclosure_accepted_at is not null as har_tidsstempel
from public.company_ai_config where company_id = (select id from t_company);

\echo ''
\echo '-- et urelateret gem må ikke flytte datoen for kundens instruks --'
select disclosure_accepted_at as foer from public.company_ai_config
where company_id = (select id from t_company) \gset

update public.company_ai_config set match_enabled = false
where company_id = (select id from t_company);

select (disclosure_accepted_at = :'foer'::timestamptz) as stempel_uaendret
from public.company_ai_config where company_id = (select id from t_company);

\echo ''
\echo '-- skift af udbyder: godkendelsen gælder en anden modtager i et andet land --'
-- Den farlige skrivning: skift udbyder OG bær godkendelsen med over i samme
-- sætning. Kunden har aldrig set et ord om den nye modtager.
update public.company_ai_config
set provider = 'google', model = 'gemini-3.5-flash', disclosure_accepted = true
where company_id = (select id from t_company);

select disclosure_accepted, disclosure_provider, disclosure_accepted_at
from public.company_ai_config where company_id = (select id from t_company);
\echo '(skal stå false / tom / tom)'

\echo ''
\echo '=== 3) Godkendelse og tilbagetrækning som egne hændelser ==================='

-- Godkend igen (nu for Google), og træk den derefter tilbage.
select public.accept_ai_disclosure((select id from t_company), 'google', public.ai_disclosure_version());
update public.company_ai_config set disclosure_accepted = false
where company_id = (select id from t_company);

select action, level, category, detail->>'provider' as provider, detail->>'version' as version
from public.audit_log
where company_id = (select id from t_company) and action like 'ai.%'
order by id;

rollback;

-- Fixtures for AI-label-matchningen (20260807132720_ai_label_matching.sql).
--
-- Kør mod den LOKALE stak — den ruller alt tilbage til sidst og efterlader
-- intet:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/name_matching.sql
--
-- Formålet er at kunne ÆNDRE tærsklerne i ai_match_label_fields og se på tal
-- frem for fornemmelser. Hver række viser den forventede opførsel:
--   auto  = ét entydigt match, klienten må udfylde feltet
--   pick  = kandidater, men et menneske skal vælge
--   none  = intet brugbart match
--
-- De negative rækker er de vigtige: to medarbejdere med næsten samme navn skal
-- ende i 'pick', ikke i et gæt.

begin;

\set QUIET on
\pset footer off

create temporary table t_company (id uuid);
insert into t_company
select id from public.companies order by created_at limit 1;

-- Medarbejdere med bevidst svære navne: æ/ø/å, dobbelt-a, og to par der
-- ligner hinanden.
insert into public.employees (company_id, full_name, initials, is_active)
select id, v.name, v.ini, true
from t_company, (values
  ('Åse Østergård',      'AAØ'),
  ('Åse Østerby',        'AAB'),
  ('Jørgen Kjærsgaard',  'JKG'),
  ('Mikkel Ærø',         'MAE'),
  ('Søren Sørensen',     'SSO'),
  ('Sofie Sørensen',     'SFS')
) as v(name, ini);

insert into public.carriers (company_id, name, is_active)
select id, v.name, true
from t_company, (values ('PostNord'), ('GLS'), ('DAO'), ('Bring')) as v(name)
where not exists (
  select 1 from public.carriers c where c.company_id = t_company.id and c.name = v.name
);

\set QUIET off

-- ---------------------------------------------------------------------------
-- 1) Foldningen alene — disse SKAL blive eksakt ens (score 1.0, ingen fuzzy)
-- ---------------------------------------------------------------------------
select
  label,
  public.fold_name(label) as folded,
  public.name_similarity(label, 'Åse Østergård') as score
from (values
  ('Åse Østergård'),   -- identisk
  ('AAse Østergård'),  -- aa for å        (fra dit eksempel)
  ('Åse Ostergård'),   -- o for ø         (fra dit eksempel)
  ('AASE OESTERGAARD'), -- versaler + oe/aa
  ('Aase  Østergaard'), -- dobbelt mellemrum
  ('Åse Østergård.')   -- tegnsætning
) as v(label);

-- ---------------------------------------------------------------------------
-- 2) Ægte stavefejl — her arbejder Levenshtein/trigram
-- ---------------------------------------------------------------------------
select
  label,
  public.name_similarity(label, 'Åse Østergård') as score
from (values
  ('Åse Østegård'),    -- manglende r     (fra dit eksempel)
  ('Ase Ostergard'),   -- ingen diakritik overhovedet
  ('Åse Østergårdd'),  -- dobbelt-tegn
  ('Ase 0stergard'),   -- OCR: 0 for O
  ('Åse Østerby'),     -- ANDEN medarbejder — må IKKE nå auto-tærsklen
  ('Jørgen Kjærsgaard') -- helt andet navn
) as v(label);

-- ---------------------------------------------------------------------------
-- 3) Hele beslutningen (auto / pick / none) som klienterne ser den
-- ---------------------------------------------------------------------------
select
  v.label,
  v.expect,
  (m -> 'receiver' ->> 'auto')::boolean as auto,
  jsonb_array_length(coalesce(m -> 'receiver' -> 'candidates', '[]'::jsonb)) as n,
  m -> 'receiver' -> 'candidates' -> 0 ->> 'full_name' as best,
  m -> 'receiver' -> 'candidates' -> 0 ->> 'score' as best_score,
  m -> 'receiver' -> 'candidates' -> 1 ->> 'score' as second_score
from (values
  ('Åse Østergård',      'auto'),
  ('AAse Østergård',     'auto'),
  ('Åse Ostergård',      'auto'),
  ('Åse Østegård',       'auto'),
  ('AAØ',                'auto'),  -- initialer fra labelen
  ('Søren Sørensen',     'auto'),  -- trods Sofie Sørensen tæt på
  ('Sørensen',           'pick'),  -- efternavn alene: to kandidater
  ('Åse',                'pick'),  -- fornavn alene: Østergård og Østerby
  ('Hans Hansen',        'none')   -- ingen i huset
) as v(label, expect),
lateral (
  select public.ai_match_label_fields((select id from t_company), v.label, null, null) as m
) x;

-- ---------------------------------------------------------------------------
-- 4) Fragtfirma
-- ---------------------------------------------------------------------------
select
  v.label,
  v.expect,
  (m -> 'carrier' ->> 'auto')::boolean as auto,
  m -> 'carrier' -> 'candidates' -> 0 ->> 'name' as best,
  m -> 'carrier' -> 'candidates' -> 0 ->> 'score' as best_score
from (values
  ('PostNorb',        'auto'),  -- fra dit eksempel
  ('POST NORD',       'auto'),
  ('Postnord DK',     'auto'),
  ('G L S',           'auto'),
  ('Dao365',          'auto'),
  ('Fedex',           'none')   -- ikke på virksomhedens liste
) as v(label, expect),
lateral (
  select public.ai_match_label_fields((select id from t_company), null, v.label, null) as m
) x;

rollback;

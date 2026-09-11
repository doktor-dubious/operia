-- Fixtures for det samlede kundeudtræk (EVU-krav F-08).
--
-- Kør mod den lokale stak:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/company_full_export.sql
-- eller mod projektet (alt rulles tilbage til sidst):
--   PGPASSWORD=$SUPABASE_DB_PASSWORD psql "host=aws-0-eu-north-1.pooler.supabase.com \
--     port=5432 user=postgres.rjlxmdfmktucunxehtqz dbname=postgres sslmode=require" \
--     -f supabase/tests/company_full_export.sql
--
-- Prøverne er ikke "virker eksporten" — det ser man på skærmen. De er de
-- steder, hvor en eksportfunktion kan gøre skade: udlevere til den forkerte,
-- udlevere en tabel den ikke må, udlevere en nøgle, udlevere uden at efterlade
-- spor — og tabe en tabel stille, fordi hvidlisten er håndskrevet.

\set ON_ERROR_STOP on
begin;

-- Virksomheden er den, der har en manager — flere kan dele created_at.
select a.company_id as cid from public.app_users a
 where exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
 order by a.created_at limit 1 \gset
select a.user_id::text as mgr
  from public.app_users a
  where a.company_id = :'cid'
    and exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
  limit 1 \gset

-- Virksomheds-id'et bæres videre i en GUC, så DO-blokkene kan læse det —
-- psql-variabler findes ikke inde i plpgsql. Den FREMMEDE virksomhed skal
-- findes her, mens vi stadig er superbruger: efter rolleskiftet skjuler RLS den,
-- og prøven ville springe sig selv over i stedet for at fejle.
select set_config('operia.test_cid', :'cid', true) as _;
select set_config('operia.test_other',
  coalesce((select id::text from public.companies where id <> :'cid' limit 1), ''), true) as _;

-- En fragtaftale med en nøgle, så maskeringen har noget at maskere.
insert into public.carrier_agreements (company_id, agreement_type, provider, name, api_key)
values (:'cid', 'carrier', 'other', 'Prøveaftale', 'hemmelig-nøgle-42');

-- 0) Hvidlisten dækker: enhver tabel med company_id står enten i
--    company_export_catalog() eller i company_export_excluded(). Køres som
--    superbruger, da information_schema ellers kun viser hvad rollen må se.
do $$
declare missing text;
begin
  select string_agg(c.table_name, ', ' order by c.table_name) into missing
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.column_name = 'company_id'
    and not exists (select 1 from public.company_export_catalog() x where x.tbl = c.table_name)
    and not exists (select 1 from public.company_export_excluded() x where x.tbl = c.table_name);
  if missing is not null then
    raise exception 'FEJL: company_id-tabeller uden for både hvidliste og undtagelser: %', missing;
  end if;
  raise notice '0 ok: alle company_id-tabeller er enten hvidlistet eller bevidst undtaget';
end $$;

-- 1) En manager i virksomheden må trække sit eget udtræk.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'mgr', 'role', 'authenticated')::text, true) as _;

do $$
declare v jsonb;
begin
  v := public.company_export_manifest(current_setting('operia.test_cid')::uuid, array['core']);
  if (v->>'total_rows')::bigint < 1 then
    raise exception 'FEJL: manifestet var tomt for egen virksomhed';
  end if;
  raise notice '1 ok: manifest for egen virksomhed, % rækker', v->>'total_rows';
end $$;

-- 2) Samme manager må IKKE trække en anden virksomheds data.
do $$
declare v jsonb; other uuid;
begin
  other := nullif(current_setting('operia.test_other', true), '')::uuid;
  if other is null then
    raise notice '2 sprunget over: kun én virksomhed i basen';
    return;
  end if;
  begin
    v := public.company_export_manifest(other, array['core']);
    raise exception 'FEJL: fremmed virksomheds manifest blev udleveret';
  exception when sqlstate '42501' then
    raise notice '2 ok: fremmed virksomhed afvist';
  end;
  begin
    v := public.company_export_begin(other, array['core']);
    raise exception 'FEJL: fremmed virksomheds udtræk blev startet';
  exception when sqlstate '42501' then
    raise notice '2b ok: fremmed virksomheds udtræk afvist';
  end;
end $$;

-- 3) En tabel uden for hvidlisten kan ikke navngives — heller ikke en
--    hemmelighedstabel, og heller ikke en tabel der findes. (Hvidlisten
--    tjekkes FØR billetten, så prøven kører uden.)
do $$
declare n int;
begin
  begin
    select count(*) into n from public.company_export_rows(
      current_setting('operia.test_cid')::uuid, 'company_slack_secret', gen_random_uuid());
    raise exception 'FEJL: hemmelighedstabel blev udleveret';
  exception when sqlstate 'P0001' then
    raise notice '3a ok: company_slack_secret afvist';
  end;
  begin
    select count(*) into n from public.company_export_rows(
      current_setting('operia.test_cid')::uuid, 'platform_settings', gen_random_uuid());
    raise exception 'FEJL: platformtabel blev udleveret';
  exception when sqlstate 'P0001' then
    raise notice '3b ok: platform_settings afvist';
  end;
end $$;

-- 4) Ingen rækker uden billet: et direkte kald med et opfundet export_id
--    (eller uden) afvises, og udleverer dermed intet uden spor.
do $$
declare n int;
begin
  begin
    select count(*) into n from public.company_export_rows(
      current_setting('operia.test_cid')::uuid, 'employees', gen_random_uuid());
    raise exception 'FEJL: rækker udleveret uden billet';
  exception when sqlstate '42501' then
    raise notice '4a ok: opfundet billet afvist';
  end;
  begin
    select count(*) into n from public.company_export_rows(
      current_setting('operia.test_cid')::uuid, 'employees', null);
    raise exception 'FEJL: rækker udleveret uden billet (null)';
  exception when sqlstate '42501' then
    raise notice '4b ok: manglende billet afvist';
  end;
end $$;

-- 5) Udtrækket starter med et spor (warning) og en billet; billetten gælder
--    kun de grupper, der blev bedt om.
do $$
declare before_n int; after_n int; lvl text; v jsonb; n int;
begin
  select count(*) into before_n from public.audit_log where action = 'privacy.full_export';
  v := public.company_export_begin(
    current_setting('operia.test_cid')::uuid, array['core','shipping']);
  select count(*) into after_n from public.audit_log where action = 'privacy.full_export';
  if after_n <> before_n + 1 then
    raise exception 'FEJL: starten af udtrækket blev ikke logget';
  end if;
  if v->>'export_id' is null then
    raise exception 'FEJL: ingen billet i svaret';
  end if;
  perform set_config('operia.test_export', v->>'export_id', true);
  select public.audit_level('privacy.full_export', null) into lvl;
  if lvl <> 'warning' then
    raise exception 'FEJL: forventede niveau warning, fik %', lvl;
  end if;
  -- En tabel i en gruppe uden for billetten afvises.
  begin
    select count(*) into n from public.company_export_rows(
      current_setting('operia.test_cid')::uuid, 'bookings', (v->>'export_id')::uuid);
    raise exception 'FEJL: tabel uden for billettens grupper blev udleveret';
  exception when sqlstate '42501' then
    raise notice '5 ok: logget som warning, billet udstedt, fremmed gruppe afvist';
  end;
end $$;

-- 6) De to nøglefelter, der ligger i almindelige tabeller, maskeres (med
--    billet fra prøve 5 — gruppen shipping).
do $$
declare r jsonb; n int := 0;
begin
  for r in select * from public.company_export_rows(
      current_setting('operia.test_cid')::uuid, 'carrier_agreements',
      current_setting('operia.test_export')::uuid) loop
    n := n + 1;
    if r->>'api_key' is not null and r->>'api_key' <> '***' then
      raise exception 'FEJL: carrier_agreements.api_key blev udleveret i klartekst';
    end if;
  end loop;
  if n < 1 then
    raise exception 'FEJL: ingen fragtaftaler med gyldig billet';
  end if;
  raise notice '6 ok: % fragtaftaler, ingen nøgle i klartekst', n;
end $$;

-- 7) Nøglesat paginering på bigint-id: side 2 begynder efter side 1's sidste
--    id, og de to sider overlapper ikke.
do $$
declare p1 jsonb[]; p2 jsonb[]; last_id text;
begin
  select coalesce(array_agg(x), '{}') into p1 from public.company_export_rows(
    current_setting('operia.test_cid')::uuid, 'audit_log',
    current_setting('operia.test_export')::uuid, null, 2) x;
  if coalesce(array_length(p1, 1), 0) < 2 then
    raise notice '7 sprunget over: færre end 2 audit-rækker';
    return;
  end if;
  last_id := p1[2]->>'id';
  select coalesce(array_agg(x), '{}') into p2 from public.company_export_rows(
    current_setting('operia.test_cid')::uuid, 'audit_log',
    current_setting('operia.test_export')::uuid, last_id, 2) x;
  if coalesce(array_length(p2, 1), 0) >= 1 and (p2[1]->>'id')::bigint <= last_id::bigint then
    raise exception 'FEJL: side 2 begynder ikke efter side 1 (% <= %)', p2[1]->>'id', last_id;
  end if;
  raise notice '7 ok: bigint-markør (efter id %) giver næste side', last_id;
end $$;

-- 8) Frit opfundne gruppenavne når ikke frem til den uforanderlige log.
do $$
declare d jsonb; v jsonb;
begin
  v := public.company_export_begin(
    current_setting('operia.test_cid')::uuid, array['core','<script>alert(1)</script>']);
  select detail into d from public.audit_log
   where action = 'privacy.full_export' and detail->>'export_id' = v->>'export_id' limit 1;
  if d->'groups' <> '["core"]'::jsonb then
    raise exception 'FEJL: ikke-hvidlistet gruppenavn nåede loggen: %', d->'groups';
  end if;
  raise notice '8 ok: gruppenavne hvidlistes (%)', d->'groups';
end $$;

-- 9) Kvitteringen bærer billetten og filtællingen; uden billet ingen kvittering.
do $$
declare d jsonb;
begin
  perform public.log_company_export(
    current_setting('operia.test_cid')::uuid, current_setting('operia.test_export')::uuid, 7, 70, 4243);
  select detail into d from public.audit_log
   where action = 'privacy.full_export_delivered' and detail->>'files' = '4243' limit 1;
  if d is null or d->>'export_id' <> current_setting('operia.test_export') then
    raise exception 'FEJL: kvitteringen nåede ikke sporet med billetten';
  end if;
  begin
    perform public.log_company_export(
      current_setting('operia.test_cid')::uuid, gen_random_uuid(), 1, 1, 1);
    raise exception 'FEJL: kvittering uden billet blev accepteret';
  exception when sqlstate '42501' then
    raise notice '9 ok: kvittering logget (% filer), uden billet afvist', d->>'files';
  end;
end $$;

rollback;

-- Fixtures for fakturakladden (EVU-krav C-01, C-06, C-07, C-08, C-10).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/invoice_drafts.sql
--
-- Prøverne er regnestykket og de fire steder, hvor en fakturakladde kan gøre
-- skade: forkert beløb, en booking der forsvinder i stilhed, en pris der
-- flytter sig efter dannelsen, og et grundlag der kan rettes efter overførsel.

\set ON_ERROR_STOP on
begin;

-- Virksomheden er den, der har en manager — flere kan dele created_at.
select a.company_id as cid from public.app_users a
 where exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
 order by a.created_at limit 1 \gset
select id as eid from public.employees where company_id = :'cid' limit 1 \gset
select set_config('operia.t_cid', :'cid', true) as _;
select set_config('operia.t_eid', :'eid', true) as _;
select a.user_id::text as mgr from public.app_users a
 where a.company_id = :'cid'
   and exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
 limit 1 \gset

-- 0) Dagtællingen. 16.–18. september 2026 er ons–fre: 3 dage begge veje.
--    12.–14. september er lør–man: 3 kalenderdage, 1 hverdag.
do $$
begin
  if public.booking_day_count('2026-09-16 10:00+02', '2026-09-18 16:00+02', 'calendar') <> 3
  then raise exception 'FEJL: kalenderdage'; end if;
  if public.booking_day_count('2026-09-12 10:00+02', '2026-09-14 16:00+02', 'calendar') <> 3
  then raise exception 'FEJL: kalenderdage over weekend'; end if;
  if public.booking_day_count('2026-09-12 10:00+02', '2026-09-14 16:00+02', 'weekday') <> 1
  then raise exception 'FEJL: hverdage over weekend'; end if;
  if public.booking_day_count('2026-09-16 10:00+02', '2026-09-16 12:00+02', 'calendar') <> 1
  then raise exception 'FEJL: to timer skal tælle som én dag'; end if;
  raise notice '0 ok: dagtælling (kalender 3/3, hverdage 1, minimum 1)';
end $$;

-- Opsætningen sker som superbruger; RPC'erne bagefter som en manager, fordi de
-- kræver en rigtig bruger (can_manage_bookings). Rækkefølgen er vigtig: efter
-- rolleskiftet er hverken auth.users eller de fleste stamdata skrivbare.
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  -- Prøven laver sin EGEN ressource. Genbrugte den en fra seed'en, ville en
  -- hvilken som helst booking, nogen havde lavet i mellemtiden, vælte den på
  -- dobbeltbookingsværnet — og prøven ville se ud som en fejl i koden.
  rid uuid;
  eid uuid := current_setting('operia.t_eid')::uuid;
  lvl uuid;
  svc uuid;
  bk uuid;
  rid2 uuid;
  bk2 uuid;
begin
  insert into public.booking_resources (company_id, name)
  values (cid, 'Prøvelokale ' || substr(gen_random_uuid()::text, 1, 8)) returning id into rid;
  perform set_config('operia.t_rid', rid::text, true);

  insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount, valid_from)
  values (cid, 'resource', rid, 'day', 1200, date '2026-01-01');

  insert into public.booking_participant_levels (company_id, name)
  values (cid, 'Prøveniveau') returning id into lvl;
  insert into public.booking_tariffs (company_id, scope, level_id, unit, amount, valid_from)
  values (cid, 'level', lvl, 'person_day', 185, date '2026-01-01');

  insert into public.booking_services (company_id, name, has_quantity, price_mode, unit_price)
  values (cid, 'Prøveforplejning', true, 'unit', 95) returning id into svc;

  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at,
                               status, title, participant_count, participant_level_id)
  values (cid, rid, eid, '2026-08-12 09:00+02', '2026-08-14 16:00+02',
          'booked', 'Prøvekursus', 20, lvl)
  returning id into bk;

  insert into public.booking_service_lines (company_id, booking_id, service_id, quantity,
                                            unit_price, price_mode)
  values (cid, bk, svc, 60, 95, 'unit');

  -- Bookingen uden pris (prøve 2).
  insert into public.booking_resources (company_id, name)
  values (cid, 'Lokale uden pris') returning id into rid2;
  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at, status, title)
  values (cid, rid2, eid, '2026-08-21 09:00+02', '2026-08-21 12:00+02', 'booked', 'Uprissat')
  returning id into bk2;

  perform set_config('operia.t_bk', bk::text, true);
  perform set_config('operia.t_bk2', bk2::text, true);
  perform set_config('operia.t_lvl', lvl::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'mgr', 'role', 'authenticated')::text, true) as _;

-- 1) Lokale × dage × pris, plus kursistniveau (C-07) og tilkøb (C-06).
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  bk uuid := current_setting('operia.t_bk')::uuid;
  res jsonb;
  v_total numeric;
begin
  res := public.generate_invoice_draft(cid, array[bk]);

  select sum(amount) into v_total from public.invoice_draft_lines
   where draft_id = (res->>'draft_id')::uuid;

  -- 3 dage × 1.200          =  3.600
  -- 20 kursister × 3 dage × 185 = 11.100
  -- 60 × 95                 =  5.700
  --                           -------
  --                           20.400
  if v_total <> 20400 then
    raise exception 'FEJL: forventede 20400, fik %', v_total;
  end if;
  if (res->>'lines')::int <> 3 then
    raise exception 'FEJL: forventede 3 linjer, fik %', res->>'lines';
  end if;
  raise notice '1 ok: 3.600 + 11.100 + 5.700 = 20.400 på 3 linjer';
  perform set_config('operia.t_draft', res->>'draft_id', true);
end $$;

-- 2) Ingen booking kan overses: en booking uden pris kommer TILBAGE i svaret.
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  bk2 uuid := current_setting('operia.t_bk2')::uuid;
  res jsonb;
begin
  res := public.generate_invoice_draft(cid, array[bk2]);
  if res->>'draft_id' is not null then
    raise exception 'FEJL: en kladde uden linjer blev gemt';
  end if;
  if res->'skipped'->0->>'reason' <> 'no_price' then
    raise exception 'FEJL: forventede no_price, fik %', res->'skipped';
  end if;
  raise notice '2 ok: uprissat booking meldes tilbage (no_price), ingen tom kladde';
end $$;

-- 3) Samme booking kan ikke komme på to kladder.
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  bk uuid := current_setting('operia.t_bk')::uuid;
  res jsonb;
begin
  res := public.generate_invoice_draft(cid, array[bk]);
  if res->'skipped'->0->>'reason' <> 'on_other_draft' then
    raise exception 'FEJL: forventede on_other_draft, fik %', res->'skipped';
  end if;
  raise notice '3 ok: en booking kan kun ligge på én kladde';
end $$;

-- 4) Prissnapshot: en senere prisændring rører ikke kladden (C-05's anden halvdel).
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  rid uuid := current_setting('operia.t_rid')::uuid;
  d uuid := current_setting('operia.t_draft')::uuid;
  v numeric;
begin
  update public.booking_tariffs set valid_to = date '2026-09-30'
   where company_id = cid and resource_id = rid and unit = 'day';
  insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount, valid_from)
  values (cid, 'resource', rid, 'day', 9999, date '2026-10-01');

  select unit_price into v from public.invoice_draft_lines
   where draft_id = d and source = 'resource';
  if v <> 1200 then
    raise exception 'FEJL: kladdens pris flyttede sig til %', v;
  end if;
  raise notice '4 ok: kladden holder sin egen pris (1200), selv om taksten er ændret';
end $$;

-- 5) Godkendelse og overførsel — og at bookingen bliver faktureret og låst.
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  d uuid := current_setting('operia.t_draft')::uuid;
  bk uuid := current_setting('operia.t_bk')::uuid;
  st text;
  v_no text;
  inv timestamptz;
begin
  perform public.approve_invoice_draft(d, true);
  select status into st from public.invoice_drafts where id = d;
  if st <> 'approved' then raise exception 'FEJL: status blev %', st; end if;

  perform public.transfer_invoice_draft(d, '2026-0042', 'manual', null);
  select status, invoice_no into st, v_no from public.invoice_drafts where id = d;
  if st <> 'transferred' or v_no <> '2026-0042' then
    raise exception 'FEJL: overførslen gav status % / nummer %', st, v_no;
  end if;
  select invoiced_at into inv from public.bookings where id = bk;
  if inv is null then
    raise exception 'FEJL: bookingen blev ikke markeret faktureret ved overførsel';
  end if;
  raise notice '5 ok: godkendt → overført (nr. %), bookingen faktureret og låst', v_no;
end $$;

-- 6) Efter overførsel er grundlaget et bilag, ikke et arbejdsdokument.
do $$
declare d uuid := current_setting('operia.t_draft')::uuid;
begin
  begin
    perform public.add_invoice_draft_line(d, 'Snydelinje', 1, 1000);
    raise exception 'FEJL: en linje blev tilføjet en overført kladde';
  exception when sqlstate 'P0001' then
    raise notice '6 ok: overført kladde kan ikke ændres';
  end;
end $$;

-- 7) Sporet.
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid; n int;
begin
  select count(*) into n from public.audit_log
   where company_id = cid and action like 'invoice_draft.%';
  if n < 3 then
    raise exception 'FEJL: ventede mindst 3 kladde-hændelser, fandt %', n;
  end if;
  raise notice '7 ok: % kladde-hændelser i sporet', n;
end $$;

rollback;

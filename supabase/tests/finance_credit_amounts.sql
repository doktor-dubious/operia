-- Fixtures: økonomirolle (F-01/C-08), kreditnota (C-09), beløb i loggen (D-04).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/finance_credit_amounts.sql
\set ON_ERROR_STOP on
begin;

-- Virksomheden er den, der har en manager — flere kan dele created_at.
select a.company_id as cid from public.app_users a
 where exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
 order by a.created_at limit 1 \gset
select id as eid from public.employees where company_id = :'cid' limit 1 \gset
select set_config('operia.t_cid', :'cid', true) as _;
select set_config('operia.t_eid', :'eid', true) as _;
-- To brugere: en ren booking_manager og en ren finance_manager (syntetiske).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000','f1000000-0000-4000-8000-000000000001','authenticated','authenticated','bm@test.local','x',now(),now(),now()),
       ('00000000-0000-0000-0000-000000000000','f1000000-0000-4000-8000-000000000002','authenticated','authenticated','fm@test.local','x',now(),now(),now());
insert into public.app_users (user_id, company_id, full_name, email) values
  ('f1000000-0000-4000-8000-000000000001', :'cid', 'Booking Manager', 'bm@test.local'),
  ('f1000000-0000-4000-8000-000000000002', :'cid', 'Finance Manager', 'fm@test.local');
insert into public.user_roles (user_id, role) values
  ('f1000000-0000-4000-8000-000000000001', 'booking_manager'),
  ('f1000000-0000-4000-8000-000000000002', 'finance_manager');

do $$
declare cid uuid := current_setting('operia.t_cid')::uuid; eid uuid := current_setting('operia.t_eid')::uuid;
        rid uuid; lvl uuid; bk uuid;
begin
  insert into public.booking_resources (company_id, name) values (cid, 'Økolokale ' || substr(gen_random_uuid()::text,1,6)) returning id into rid;
  insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount, valid_from) values (cid,'resource',rid,'day',1000,'2026-01-01');
  insert into public.booking_participant_levels (company_id, name) values (cid, 'Økoniveau') returning id into lvl;
  insert into public.booking_tariffs (company_id, scope, level_id, unit, amount, valid_from) values (cid,'level',lvl,'person',100,'2026-01-01');
  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at, status, title, participant_count, participant_level_id)
  values (cid, rid, eid, '2026-08-24 09:00+02', '2026-08-25 16:00+02', 'booked', 'Økokursus', 10, lvl) returning id into bk;
  perform set_config('operia.t_bk', bk::text, true); perform set_config('operia.t_rid', rid::text, true); perform set_config('operia.t_lvl', lvl::text, true);
end $$;

-- 1) D-04: beløb før/efter i hændelsen. 2 dage × 1000 + 10 × 100 = 3000 → 12 kursister = 3200.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true) as _;
do $$
declare bk uuid := current_setting('operia.t_bk')::uuid; rid uuid := current_setting('operia.t_rid')::uuid;
        eid uuid := current_setting('operia.t_eid')::uuid; lvl uuid := current_setting('operia.t_lvl')::uuid; d jsonb;
begin
  perform public.update_booking(bk, rid, eid, '2026-08-24 09:00+02', '2026-08-25 16:00+02', 'Økokursus', false, 12, lvl);
  select detail into d from public.booking_events where booking_id = bk and event_type = 'updated' order by id desc limit 1;
  if (d->>'amount_from')::numeric <> 3000 or (d->>'amount_to')::numeric <> 3200 then
    raise exception 'FEJL: beløb før/efter var % / %', d->>'amount_from', d->>'amount_to';
  end if;
  perform public.update_booking(bk, rid, eid, '2026-08-24 09:00+02', '2026-08-25 16:00+02', 'Nyt formål', false, 12, lvl);
  select detail into d from public.booking_events where booking_id = bk and event_type = 'updated' order by id desc limit 1;
  if d ? 'amount_from' then raise exception 'FEJL: formålsrettelse bar et beløb: %', d; end if;
  raise notice '1 ok: 3000 → 3200 i hændelsen; fritekst bærer intet beløb';
end $$;

-- 2) booking_manager kan danne kladden, men ikke godkende eller overføre.
do $$
declare res jsonb; cid uuid := current_setting('operia.t_cid')::uuid; bk uuid := current_setting('operia.t_bk')::uuid;
begin
  res := public.generate_invoice_draft(cid, array[bk]);
  perform set_config('operia.t_draft', res->>'draft_id', true);
  begin
    perform public.approve_invoice_draft((res->>'draft_id')::uuid, true);
    raise exception 'FEJL: booking_manager kunne godkende';
  exception when insufficient_privilege then null; end;
  begin
    perform public.transfer_invoice_draft((res->>'draft_id')::uuid, 'F-9');
    raise exception 'FEJL: booking_manager kunne overføre';
  exception when insufficient_privilege then null; end;
  raise notice '2 ok: booking_manager danner, men godkender/overfører ikke';
end $$;

-- 3) finance_manager godkender, overfører og krediterer.
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true) as _;
do $$
declare dr uuid := current_setting('operia.t_draft')::uuid; bk uuid := current_setting('operia.t_bk')::uuid;
        res jsonb; v numeric; inv timestamptz; lid uuid; d record;
begin
  perform public.approve_invoice_draft(dr, true);
  perform public.transfer_invoice_draft(dr, 'F-2026-77');
  select invoiced_at into inv from public.bookings where id = bk;
  if inv is null then raise exception 'FEJL: bookingen blev ikke faktureret'; end if;

  -- Delvis kreditnota: 2 af 12 kursister.
  select id into lid from public.invoice_draft_lines where draft_id = dr and source = 'participants';
  res := public.create_credit_note(dr, jsonb_build_array(jsonb_build_object('line_id', lid, 'quantity', 2)));
  select sum(amount) into v from public.invoice_draft_lines where draft_id = (res->>'draft_id')::uuid;
  if v <> -200 then raise exception 'FEJL: delvis kreditnota gav %', v; end if;
  if res->>'number' not like 'KN-%' then raise exception 'FEJL: nummer %', res->>'number'; end if;
  -- en ny kreditnota kan ikke oprettes, mens én er åben
  begin
    perform public.create_credit_note(dr);
    raise exception 'FEJL: to åbne kreditnotaer';
  exception when sqlstate 'P0001' then if sqlerrm <> 'credit_note_open' then raise; end if; end;
  perform public.approve_invoice_draft((res->>'draft_id')::uuid, true);
  perform public.transfer_invoice_draft((res->>'draft_id')::uuid, 'KN-2026-3');
  select invoiced_at into inv from public.bookings where id = bk;
  if inv is null then raise exception 'FEJL: delvis kreditnota løftede låsen'; end if;
  select * into d from public.invoice_drafts where id = dr;
  if d.credited_by_draft_id is null then raise exception 'FEJL: fakturaen kender ikke sin kreditnota'; end if;
  raise notice '3 ok: delvis kreditnota −200, bookingen stadig faktureret, fakturaen peger på kreditnotaen';
end $$;

-- 4) Fuld kreditnota løfter låsen — og bookingen kan faktureres igen.
--    Ny booking (den første er delvist krediteret og kan ikke krediteres igen).
do $$
begin
  begin
    perform public.create_credit_note(current_setting('operia.t_draft')::uuid);
    raise exception 'FEJL: allerede krediteret faktura kunne krediteres igen';
  exception when sqlstate 'P0001' then if sqlerrm <> 'already_credited' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true) as _;
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid; eid uuid := current_setting('operia.t_eid')::uuid;
        rid uuid := current_setting('operia.t_rid')::uuid; lvl uuid := current_setting('operia.t_lvl')::uuid; bk uuid;
begin
  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at, status, title, participant_count, participant_level_id)
  values (cid, rid, eid, '2026-08-27 09:00+02', '2026-08-28 16:00+02', 'booked', 'Økokursus 2', 12, lvl) returning id into bk;
  perform set_config('operia.t_bk2', bk::text, true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true) as _;
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid; bk uuid := current_setting('operia.t_bk2')::uuid;
        res jsonb; res2 jsonb; inv timestamptz; dr uuid; v numeric; link uuid;
begin
  res := public.generate_invoice_draft(cid, array[bk]);
  dr := (res->>'draft_id')::uuid;
  perform public.approve_invoice_draft(dr, true);
  perform public.transfer_invoice_draft(dr, 'F-2026-78');
  res2 := public.create_credit_note(dr);
  select sum(amount) into v from public.invoice_draft_lines where draft_id = (res2->>'draft_id')::uuid;
  if v <> -3200 then raise exception 'FEJL: fuld kreditnota gav %', v; end if;
  perform public.approve_invoice_draft((res2->>'draft_id')::uuid, true);
  perform public.transfer_invoice_draft((res2->>'draft_id')::uuid, 'KN-2026-4');
  select invoiced_at, invoice_draft_id into inv, link from public.bookings where id = bk;
  if inv is not null or link is not null then raise exception 'FEJL: fuld kreditnota løftede ikke låsen'; end if;
  -- og den kan faktureres igen
  res := public.generate_invoice_draft(cid, array[bk]);
  if res->>'draft_id' is null then raise exception 'FEJL: bookingen kunne ikke faktureres igen: %', res->'skipped'; end if;
  raise notice '4 ok: fuld kreditnota −3200 → låsen løftet, bookingen faktureres igen som %', res->>'number';
  perform set_config('operia.t_draft3', res->>'draft_id', true);
end $$;

-- 5) Overførsel til et regnskabssystem uden fakturanummer (kladde dér), og
--    nummeret skrevet tilbage bagefter (C-02).
do $$
declare dr uuid := current_setting('operia.t_draft3')::uuid; d record;
begin
  perform public.approve_invoice_draft(dr, true);
  begin
    perform public.transfer_invoice_draft(dr, null, 'manual', null);
    raise exception 'FEJL: manuel overførsel uden nummer blev accepteret';
  exception when sqlstate 'P0001' then if sqlerrm <> 'invoice_no_required' then raise; end if; end;
  perform public.transfer_invoice_draft(dr, null, 'economic', '4711');
  select * into d from public.invoice_drafts where id = dr;
  if d.status <> 'transferred' or d.external_id <> '4711' or d.invoice_no is not null then
    raise exception 'FEJL: e-conomic-overførsel uden nummer gav status % / nr %', d.status, d.invoice_no;
  end if;
  perform public.record_invoice_booked(dr, '2026-0099');
  select * into d from public.invoice_drafts where id = dr;
  if d.invoice_no <> '2026-0099' then raise exception 'FEJL: fakturanummer ikke skrevet tilbage'; end if;
  raise notice '5 ok: e-conomic-kladde 4711 uden nummer → bogført som 2026-0099';
end $$;

rollback;

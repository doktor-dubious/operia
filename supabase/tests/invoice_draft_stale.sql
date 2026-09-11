-- Fixtures for "rettelser slår igennem på fakturagrundlaget" (EVU A-03/A-07/C-10).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/invoice_draft_stale.sql

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

do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  eid uuid := current_setting('operia.t_eid')::uuid;
  rid uuid; bk uuid; bk2 uuid;
begin
  insert into public.booking_resources (company_id, name)
  values (cid, 'Prøvelokale ' || substr(gen_random_uuid()::text, 1, 8)) returning id into rid;
  insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount, valid_from)
  values (cid, 'resource', rid, 'day', 1000, date '2026-01-01');
  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at, status, title, participant_count)
  values (cid, rid, eid, '2026-08-03 09:00+02', '2026-08-04 16:00+02', 'booked', 'Kursus A', 10)
  returning id into bk;
  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at, status, title)
  values (cid, rid, eid, '2026-08-10 09:00+02', '2026-08-10 16:00+02', 'booked', 'Kursus B')
  returning id into bk2;
  perform set_config('operia.t_rid', rid::text, true);
  perform set_config('operia.t_bk', bk::text, true);
  perform set_config('operia.t_bk2', bk2::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'mgr', 'role', 'authenticated')::text, true) as _;

-- 1) Kladde af to bookinger, godkendt. Så rettes deltagerantallet på den ene.
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  bk uuid := current_setting('operia.t_bk')::uuid;
  bk2 uuid := current_setting('operia.t_bk2')::uuid;
  rid uuid := current_setting('operia.t_rid')::uuid;
  eid uuid := current_setting('operia.t_eid')::uuid;
  res jsonb; d record;
begin
  res := public.generate_invoice_draft(cid, array[bk, bk2]);
  perform set_config('operia.t_draft', res->>'draft_id', true);
  perform public.approve_invoice_draft((res->>'draft_id')::uuid, true);
  select * into d from public.invoice_drafts where id = (res->>'draft_id')::uuid;
  if d.status <> 'approved' then raise exception 'FEJL: kunne ikke godkende'; end if;

  perform public.update_booking(bk, rid, eid, '2026-08-03 09:00+02', '2026-08-04 16:00+02',
                                'Kursus A', false, 12, null);
  select * into d from public.invoice_drafts where id = (res->>'draft_id')::uuid;
  if d.stale_at is null or d.stale_reason <> 'booking_updated' then
    raise exception 'FEJL: kladden blev ikke stemplet forældet (%)', d.stale_reason;
  end if;
  if d.status <> 'draft' or d.approved_at is not null then
    raise exception 'FEJL: godkendelsen blev ikke trukket tilbage';
  end if;
  raise notice '1 ok: rettelse → kladde forældet, godkendelse trukket tilbage';
end $$;

-- 2) En forældet kladde kan hverken godkendes eller overføres.
do $$
declare dr uuid := current_setting('operia.t_draft')::uuid;
begin
  begin
    perform public.approve_invoice_draft(dr, true);
    raise exception 'FEJL: forældet kladde kunne godkendes';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'draft_stale' then raise; end if;
  end;
  begin
    perform public.transfer_invoice_draft(dr, 'F-1001');
    raise exception 'FEJL: forældet kladde kunne overføres';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'draft_stale' then raise; end if;
  end;
  raise notice '2 ok: forældet kladde afvises ved godkendelse og overførsel';
end $$;

-- 3) Formålet (fritekst) rører ikke beløbene og forælder ikke.
do $$
declare
  bk uuid := current_setting('operia.t_bk')::uuid; rid uuid := current_setting('operia.t_rid')::uuid;
  eid uuid := current_setting('operia.t_eid')::uuid; dr uuid := current_setting('operia.t_draft')::uuid;
  res jsonb; d record; n int;
begin
  res := public.regenerate_invoice_draft(dr);
  perform set_config('operia.t_draft', res->>'draft_id', true);
  select * into d from public.invoice_drafts where id = (res->>'draft_id')::uuid;
  if d.stale_at is not null then raise exception 'FEJL: ny kladde født forældet'; end if;
  if res->>'replaced' is null then raise exception 'FEJL: svaret nævner ikke den afløste'; end if;
  select status into d from public.invoice_drafts where id = dr;
  if d.status <> 'cancelled' then raise exception 'FEJL: gammel kladde ikke annulleret'; end if;
  -- 12 kursister er nu grundlaget: 2 dage × 1000 pr. booking, ingen niveautakst → 2000 + 1000
  select sum(amount) into n from public.invoice_draft_lines where draft_id = (res->>'draft_id')::uuid;
  if n <> 3000 then raise exception 'FEJL: forventede 3000, fik %', n; end if;

  perform public.update_booking(bk, rid, eid, '2026-08-03 09:00+02', '2026-08-04 16:00+02',
                                'Kursus A — nyt formål', false, 12, null);
  select * into d from public.invoice_drafts where id = (res->>'draft_id')::uuid;
  if d.stale_at is not null then raise exception 'FEJL: formålsændring forældede kladden'; end if;
  raise notice '3 ok: dan igen → ny kladde (3000), gammel annulleret; fritekst forælder ikke';
end $$;

-- 4) Afbestilling på en åben kladde → forældet; dan igen udelader den (A-07).
do $$
declare
  bk2 uuid := current_setting('operia.t_bk2')::uuid; dr uuid := current_setting('operia.t_draft')::uuid;
  res jsonb; d record; n int;
begin
  perform public.cancel_booking(bk2, 'Aflyst af kunden');
  select * into d from public.invoice_drafts where id = dr;
  if d.stale_reason <> 'booking_cancelled' then raise exception 'FEJL: afbestilling forældede ikke (%)', d.stale_reason; end if;
  res := public.regenerate_invoice_draft(dr);
  select count(distinct booking_id) into n from public.invoice_draft_lines where draft_id = (res->>'draft_id')::uuid;
  if n <> 1 then raise exception 'FEJL: den afbestilte booking kom med igen (% bookinger)', n; end if;
  perform set_config('operia.t_draft', res->>'draft_id', true);
  raise notice '4 ok: afbestilling → forældet; dan igen udelader den afbestilte';
end $$;

-- 5) Efter overførsel: låst, ikke forældet (kreditnota er vejen, C-09).
do $$
declare
  dr uuid := current_setting('operia.t_draft')::uuid; bk uuid := current_setting('operia.t_bk')::uuid;
  rid uuid := current_setting('operia.t_rid')::uuid; eid uuid := current_setting('operia.t_eid')::uuid;
  d record;
begin
  perform public.approve_invoice_draft(dr, true);
  perform public.transfer_invoice_draft(dr, 'F-1002');
  begin
    perform public.update_booking(bk, rid, eid, '2026-08-03 09:00+02', '2026-08-04 16:00+02',
                                  'Kursus A', false, 30, null);
    raise exception 'FEJL: faktureret booking kunne rettes';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'booking_invoiced' then raise; end if;
  end;
  select * into d from public.invoice_drafts where id = dr;
  if d.status <> 'transferred' or d.stale_at is not null then
    raise exception 'FEJL: overført kladde ændrede tilstand';
  end if;
  raise notice '5 ok: efter overførsel er bookingen låst og kladden urørt';
end $$;

rollback;

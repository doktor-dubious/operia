-- Fixtures for rettelserne efter code review 2026-09-14 (migration
-- 20260914090000): dagtælling, ufuldførte bookinger i kladden, tomt antal på
-- kreditnota, import uden reference, og opbevaringspurgen mod fakturagrundlaget.
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/review_fixes_20260914.sql
\set ON_ERROR_STOP on
begin;

select a.company_id as cid from public.app_users a
 where exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
 order by a.created_at limit 1 \gset
select id as eid from public.employees where company_id = :'cid' and is_active limit 1 \gset
select set_config('operia.t_cid', :'cid', true) as _;
select set_config('operia.t_eid', :'eid', true) as _;
select a.user_id::text as mgr from public.app_users a
 where a.company_id = :'cid'
   and exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
 limit 1 \gset
select set_config('operia.t_email', coalesce((select email from public.employees where id = :'eid'), ''), true) as _;

-- 0) Dagtællingen er halvåben og i virksomhedens tidszone — uanset sessionens.
set local timezone = 'UTC';
do $$
begin
  if public.booking_day_count('2026-09-15 00:00+02', '2026-09-16 00:00+02', 'calendar') <> 1
  then raise exception 'FEJL: heldagsbooking skal være 1 dag'; end if;
  if public.booking_day_count('2026-09-15 00:30+02', '2026-09-15 02:00+02', 'calendar') <> 1
  then raise exception 'FEJL: natbooking før UTC-midnat skal være 1 dag'; end if;
  if public.booking_day_count('2026-09-15 22:00+02', '2026-09-16 02:00+02', 'calendar') <> 2
  then raise exception 'FEJL: booking over lokal midnat skal være 2 dage'; end if;
  if public.booking_day_count('2026-09-12 10:00+02', '2026-09-14 16:00+02', 'weekday') <> 1
  then raise exception 'FEJL: hverdage over weekend'; end if;
  if public.audit_category('invoice_draft.created') <> 'booking'
  then raise exception 'FEJL: invoice_draft.* skal ligge under booking'; end if;
  if public.audit_category('dalux.verified') <> 'imports'
  then raise exception 'FEJL: dalux.* skal ligge under imports'; end if;
  raise notice '0 ok: dagtælling halvåben i lokal tid; audit_category har begge grene';
end $$;

do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  eid uuid := current_setting('operia.t_eid')::uuid;
  rid uuid; bk_past uuid; bk_future uuid; bk_cancel uuid; bk_keep uuid;
begin
  insert into public.booking_resources (company_id, name)
  values (cid, 'Prøvelokale ' || substr(gen_random_uuid()::text, 1, 8)) returning id into rid;
  insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount, valid_from)
  values (cid, 'resource', rid, 'day', 1000, date '2020-01-01');
  update public.companies set booking_retro_allowed = true where id = cid;

  -- En afholdt, en fremtidig, og to gamle til purgen.
  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at, status, title)
  values (cid, rid, eid, date_trunc('day', now() - interval '3 days') + interval '9 hours',
          date_trunc('day', now() - interval '3 days') + interval '11 hours', 'booked', 'Afholdt')
  returning id into bk_past;
  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at, status, title)
  values (cid, rid, eid, now() + interval '3 days', now() + interval '4 days', 'booked', 'Fremtidig')
  returning id into bk_future;
  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at, status, title)
  values (cid, rid, eid, now() - interval '800 days', now() - interval '799 days', 'booked', 'Gammel, annulleret kladde')
  returning id into bk_cancel;
  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at, status, title)
  values (cid, rid, eid, now() - interval '700 days', now() - interval '699 days', 'booked', 'Gammel, overført kladde')
  returning id into bk_keep;

  perform set_config('operia.t_rid', rid::text, true);
  perform set_config('operia.t_bk_past', bk_past::text, true);
  perform set_config('operia.t_bk_future', bk_future::text, true);
  perform set_config('operia.t_bk_cancel', bk_cancel::text, true);
  perform set_config('operia.t_bk_keep', bk_keep::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'mgr', 'role', 'authenticated')::text, true) as _;

-- 1) En booking, der ikke er afholdt, kommer ikke på kladden — den meldes tilbage.
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  res jsonb;
begin
  res := public.generate_invoice_draft(cid, array[current_setting('operia.t_bk_past')::uuid,
                                                  current_setting('operia.t_bk_future')::uuid]);
  if jsonb_array_length(res->'included') <> 1 then
    raise exception 'FEJL: forventede én booking på kladden, fik %', res;
  end if;
  if res->'skipped'->0->>'reason' <> 'not_completed' then
    raise exception 'FEJL: forventede not_completed, fik %', res->'skipped';
  end if;
  if (select quantity from public.invoice_draft_lines where draft_id = (res->>'draft_id')::uuid) <> 1 then
    raise exception 'FEJL: en booking på ét døgn skal være 1 dag på dagstaksten';
  end if;
  perform set_config('operia.t_draft', res->>'draft_id', true);
  raise notice '1 ok: fremtidig booking springes over (not_completed), afholdt = 1 dag';
end $$;

-- 2) Kreditnota: et angivet, tomt antal er en fejl — ikke hele linjen.
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  d uuid := current_setting('operia.t_draft')::uuid;
  ln uuid;
  res jsonb;
begin
  perform public.approve_invoice_draft(d, true);
  perform public.transfer_invoice_draft(d, 'F-1', 'manual', null);
  select id into ln from public.invoice_draft_lines where draft_id = d limit 1;
  begin
    perform public.create_credit_note(d, jsonb_build_array(jsonb_build_object('line_id', ln, 'quantity', null)));
    raise exception 'FEJL: null-antal blev til en kreditnota';
  exception when others then
    if sqlerrm <> 'credit_quantity_invalid' then raise; end if;
  end;
  begin
    perform public.create_credit_note(d, jsonb_build_array(jsonb_build_object('line_id', ln, 'quantity', '2x')));
    raise exception 'FEJL: ulæseligt antal blev til en kreditnota';
  exception when others then
    if sqlerrm <> 'credit_quantity_invalid' then raise; end if;
  end;
  res := public.create_credit_note(d, jsonb_build_array(jsonb_build_object('line_id', ln)));
  if (select sum(quantity) from public.invoice_draft_lines where draft_id = (res->>'draft_id')::uuid) <> -1 then
    raise exception 'FEJL: udeladt antal skal kreditere hele linjen';
  end if;
  raise notice '2 ok: tomt/ulæseligt antal afvises, udeladt antal = hele linjen';
end $$;

-- 3) Import uden external_ref: tørkørsel OG anvendelse går igennem, og loggen skrives.
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  rid uuid := current_setting('operia.t_rid')::uuid;
  res jsonb;
  rows jsonb;
begin
  rows := jsonb_build_array(
    jsonb_build_object('resource', (select name from public.booking_resources where id = rid),
                       'employee', current_setting('operia.t_email'),
                       'starts_at', to_char(now() + interval '30 days', 'YYYY-MM-DD') || 'T09:00:00',
                       'ends_at', to_char(now() + interval '30 days', 'YYYY-MM-DD') || 'T11:00:00'),
    jsonb_build_object('resource', (select name from public.booking_resources where id = rid),
                       'employee', current_setting('operia.t_email'),
                       'participant_count', 'tolv',
                       'starts_at', to_char(now() + interval '31 days', 'YYYY-MM-DD') || 'T09:00:00',
                       'ends_at', to_char(now() + interval '31 days', 'YYYY-MM-DD') || 'T11:00:00'));
  res := public.import_bookings(cid, rows, false);
  if res->'results'->0->>'action' <> 'create' then
    raise exception 'FEJL: række uden reference skulle oprettes, fik %', res;
  end if;
  if res->'results'->1->>'reason' <> 'bad_value' then
    raise exception 'FEJL: ulæseligt kursisttal skulle give bad_value, fik %', res->'results'->1;
  end if;
  res := public.import_bookings(cid, rows, true, 'prøve.csv');
  if (res->>'created')::int <> 1 or (res->>'skipped')::int <> 1 then
    raise exception 'FEJL: anvendelse uden reference, fik %', res;
  end if;
  if not exists (select 1 from public.import_runs where company_id = cid and kind = 'bookings_csv'
                   and file_name = 'prøve.csv' and created_count = 1 and rejected_count = 1) then
    raise exception 'FEJL: importloggen blev ikke skrevet';
  end if;
  raise notice '3 ok: import uden reference oprettes; ulæseligt tal = bad_value; import_runs skrevet';
end $$;

-- 4) Purgen: booking på annulleret kladde ryddes (linjerne med); booking på
--    overført kladde bliver stående; og purgen kører igennem uden fejl.
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  res jsonb;
  d uuid;
begin
  res := public.generate_invoice_draft(cid, array[current_setting('operia.t_bk_cancel')::uuid]);
  perform public.cancel_invoice_draft((res->>'draft_id')::uuid);
  res := public.generate_invoice_draft(cid, array[current_setting('operia.t_bk_keep')::uuid]);
  d := (res->>'draft_id')::uuid;
  perform public.approve_invoice_draft(d, true);
  perform public.transfer_invoice_draft(d, 'F-2', 'manual', null);
end $$;

reset role;
do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
begin
  insert into public.company_retention (company_id, bookings_days) values (cid, 365)
  on conflict (company_id) do update set bookings_days = 365;
  perform public.run_retention_purge();
  if exists (select 1 from public.bookings where id = current_setting('operia.t_bk_cancel')::uuid) then
    raise exception 'FEJL: booking på annulleret kladde blev ikke ryddet';
  end if;
  if not exists (select 1 from public.bookings where id = current_setting('operia.t_bk_keep')::uuid) then
    raise exception 'FEJL: booking på overført kladde må ikke ryddes';
  end if;
  raise notice '4 ok: purgen kører igennem; annulleret kladde ryddes, overført bliver';
end $$;

rollback;

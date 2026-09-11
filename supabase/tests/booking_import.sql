-- Fixtures for bookingimport (EVU-krav B-03).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/booking_import.sql
\set ON_ERROR_STOP on
begin;
-- Virksomheden vælges som den, der HAR en booking-manager — flere virksomheder
-- kan dele created_at, og "første" er så tilfældig.
select a.company_id as cid, a.user_id::text as mgr from public.app_users a
 where exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role in ('manager','booking_manager'))
 order by a.created_at limit 1 \gset
select set_config('operia.t_cid', :'cid', true) as _;
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid; rid uuid;
begin
  insert into public.booking_resources (company_id, name, dalux_room_id) values (cid, 'Importlokale Øst', 'dlx-77') returning id into rid;
  perform set_config('operia.t_rid', rid::text, true);
  update public.companies set booking_retro_allowed = true where id = cid;
end $$;
select set_config('operia.t_email', coalesce((select email from public.employees where company_id = :'cid' and is_active and email is not null limit 1), ''), true) as _;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'mgr', 'role','authenticated')::text, true) as _;

-- 1) Tørkørsel: opslag på foldet navn og Dalux-id, medarbejder på e-mail,
--    én ukendt ressource, ét overlap inden for filen, én ugyldig tid.
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid; res jsonb; rows jsonb; n int;
begin
  rows := jsonb_build_array(
    jsonb_build_object('external_ref','D-1','resource','importlokale øst','employee',current_setting('operia.t_email'),
                       'starts_at','2026-08-05T09:00:00','ends_at','2026-08-05T12:00:00','title','Fra Dalux','participant_count',8),
    jsonb_build_object('external_ref','D-2','resource','dlx-77','employee',current_setting('operia.t_email'),'starts_at','2026-08-05T11:00:00','ends_at','2026-08-05T13:00:00'),
    jsonb_build_object('external_ref','D-3','resource','Findes ikke','employee',current_setting('operia.t_email'),'starts_at','2026-08-06T09:00:00','ends_at','2026-08-06T10:00:00'),
    jsonb_build_object('external_ref','D-4','resource','dlx-77','employee',current_setting('operia.t_email'),'starts_at','ikke en tid','ends_at','2026-08-06T10:00:00')
  );
  res := public.import_bookings(cid, rows, false);
  if (res->>'created')::int <> 1 or (res->>'skipped')::int <> 3 then
    raise exception 'FEJL: tørkørsel gav % oprettelser / % sprunget over: %', res->>'created', res->>'skipped', res->'results';
  end if;
  select count(*) into n from public.bookings where company_id = cid and external_ref like 'D-%';
  if n <> 0 then raise exception 'FEJL: tørkørslen skrev'; end if;
  if res->'results'->1->>'reason' <> 'overlap' then raise exception 'FEJL: række 2 skulle være overlap, var %', res->'results'->1->>'reason'; end if;
  if res->'results'->2->>'reason' <> 'resource_unknown' then raise exception 'FEJL: række 3'; end if;
  if res->'results'->3->>'reason' <> 'bad_time' then raise exception 'FEJL: række 4'; end if;
  raise notice '1 ok: tørkørsel — 1 oprettes, overlap i filen / ukendt ressource / ugyldig tid springes over, intet skrevet';
end $$;

-- 2) Anvend, så samme fil igen (idempotens), så rettet fil (opdatering).
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid; res jsonb; rows jsonb; n int; c int;
begin
  rows := jsonb_build_array(
    jsonb_build_object('external_ref','D-1','resource','Importlokale Øst','employee',current_setting('operia.t_email'),'starts_at','2026-08-05T09:00:00','ends_at','2026-08-05T12:00:00','title','Fra Dalux','participant_count',8));
  res := public.import_bookings(cid, rows, true);
  if (res->>'created')::int <> 1 then raise exception 'FEJL: anvend oprettede ikke: %', res->'results'; end if;
  res := public.import_bookings(cid, rows, true);
  if (res->>'unchanged')::int <> 1 or (res->>'created')::int <> 0 then raise exception 'FEJL: samme fil igen gav %', res; end if;
  select count(*) into n from public.bookings where company_id = cid and external_ref = 'D-1';
  if n <> 1 then raise exception 'FEJL: dublet: % bookinger med D-1', n; end if;
  rows := jsonb_set(rows, '{0,participant_count}', '12');
  res := public.import_bookings(cid, rows, true);
  if (res->>'updated')::int <> 1 then raise exception 'FEJL: rettet fil opdaterede ikke: %', res; end if;
  select participant_count into c from public.bookings where company_id = cid and external_ref = 'D-1';
  if c <> 12 then raise exception 'FEJL: kursister blev %', c; end if;
  select count(*) into n from public.booking_events e join public.bookings b on b.id = e.booking_id
   where b.external_ref = 'D-1' and e.event_type in ('created','updated');
  if n < 2 then raise exception 'FEJL: importen efterlod ikke hændelser (%)', n; end if;
  raise notice '2 ok: anvend → samme fil uændret → rettet fil opdateret (12 kursister), hændelser skrevet';
end $$;

-- 3) En faktureret booking rettes ikke af en fil.
do $$
declare cid uuid := current_setting('operia.t_cid')::uuid; res jsonb; rows jsonb; bk uuid;
begin
  select id into bk from public.bookings where company_id = cid and external_ref = 'D-1';
  perform public.set_booking_invoiced(bk, true);
  rows := jsonb_build_array(
    jsonb_build_object('external_ref','D-1','resource','Importlokale Øst','employee',current_setting('operia.t_email'),'starts_at','2026-08-05T09:00:00','ends_at','2026-08-05T14:00:00'));
  res := public.import_bookings(cid, rows, true);
  if res->'results'->0->>'reason' <> 'invoiced_locked' then raise exception 'FEJL: faktureret booking blev rørt: %', res; end if;
  raise notice '3 ok: faktureret booking afvises (invoiced_locked)';
end $$;
rollback;

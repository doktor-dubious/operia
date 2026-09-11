-- Fixtures for Dalux-integrationens databaselag (EVU B-06, B-07, B-09, B-10).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/dalux_integration.sql
-- Selve API-kaldene prøves mod en attrap gennem edge-funktionen; her prøves det,
-- basen skal holde uanset hvad funktionen gør.

\set ON_ERROR_STOP on
begin;

-- Virksomheden er den, der har en manager — flere kan dele created_at.
select a.company_id as cid from public.app_users a
 where exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
 order by a.created_at limit 1 \gset
select a.user_id::text as mgr from public.app_users a
 where a.company_id = :'cid'
   and exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
 limit 1 \gset
select set_config('operia.t_cid', :'cid', true) as _;
select set_config('operia.t_mgr', :'mgr', true) as _;

insert into public.company_dalux_config (company_id) values (:'cid') on conflict do nothing;

-- 1) Hemmeligheden kan hverken læses eller skrives af en indlogget manager (B-10).
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'mgr', 'role', 'authenticated')::text, true) as _;
do $$
begin
  begin
    perform * from public.company_dalux_secret;
    raise exception 'FEJL: hemmelighedstabellen kunne læses';
  exception when insufficient_privilege then
    raise notice '1 ok: company_dalux_secret er lukket for klientrollen';
  end;
end $$;

-- 2) Statusfelterne kan ikke forfalskes af klienten, men skrives af serveren.
do $$
declare v_before boolean; v_after boolean;
begin
  -- Rækken kan i forvejen have et sat flag (lokal stak efter en rigtig test),
  -- så prøven er, at klientens skrivning ikke ÆNDRER værdien.
  select api_key_set into v_before from public.company_dalux_config
   where company_id = current_setting('operia.t_cid')::uuid;
  update public.company_dalux_config set api_key_set = not v_before, verified_at = now()
   where company_id = current_setting('operia.t_cid')::uuid;
  select api_key_set into v_after from public.company_dalux_config
   where company_id = current_setting('operia.t_cid')::uuid;
  if v_after is distinct from v_before then raise exception 'FEJL: klienten kunne ændre api_key_set'; end if;
  raise notice '2a ok: klienten kan ikke forfalske status';
end $$;
-- Tilbage til serveren. `reset role` nulstiller ikke JWT-claims'ene, og med
-- dem stående ville auth.uid() stadig være manageren — og værnet ville med rette
-- afvise serverens egne skrivninger. Derfor ryddes de udtrykkeligt.
reset role;
select set_config('request.jwt.claims', '', true) as _;
do $$
declare v boolean;
begin
  -- Først væk, så flaget beviseligt starter som falsk, derefter sat.
  delete from public.company_dalux_secret where company_id = current_setting('operia.t_cid')::uuid;
  select api_key_set into v from public.company_dalux_config
   where company_id = current_setting('operia.t_cid')::uuid;
  if v then raise exception 'FEJL: flaget forblev sat efter sletning af nøglen'; end if;
  insert into public.company_dalux_secret (company_id, api_key)
  values (current_setting('operia.t_cid')::uuid, 'k');
  select api_key_set into v from public.company_dalux_config
   where company_id = current_setting('operia.t_cid')::uuid;
  if not v then raise exception 'FEJL: spejlingen af nøgle-flaget virker ikke'; end if;
  raise notice '2b ok: serveren spejler "nøgle sat" begge veje';
end $$;

-- 3) Udgående bookinger kræver et aftalt objekt (B-08 som constraint).
do $$
begin
  begin
    update public.company_dalux_config set sync_bookings_out = true
     where company_id = current_setting('operia.t_cid')::uuid;
    raise exception 'FEJL: bookinger kunne slås til uden booking_target';
  exception when check_violation then
    raise notice '3 ok: bookinger ud kræver booking_target';
  end;
end $$;

-- 4) Tidsplanen: dagligt kl. 02:00 dansk tid, næste kørsel efter sidste.
do $$
declare c public.company_dalux_config; nxt timestamptz;
begin
  update public.company_dalux_config
     set enabled = true, verified_at = now(), schedule_mode = 'daily', run_time = '02:00',
         last_run_at = timestamptz '2026-09-10 02:00+02'
   where company_id = current_setting('operia.t_cid')::uuid;
  select * into c from public.company_dalux_config where company_id = current_setting('operia.t_cid')::uuid;
  nxt := public.dalux_next_run(c);
  if nxt is null or (nxt at time zone 'Europe/Copenhagen')::time <> time '02:00' then
    raise exception 'FEJL: daglig kørsel gav %', nxt;
  end if;
  if nxt <= c.last_run_at then raise exception 'FEJL: næste kørsel ligger ikke efter sidste'; end if;
  if (nxt at time zone 'Europe/Copenhagen')::date <> (c.last_run_at at time zone 'Europe/Copenhagen')::date + 1 then
    raise exception 'FEJL: dagen efter sidste kørsel forventet, fik %', nxt at time zone 'Europe/Copenhagen';
  end if;
  raise notice '4a ok: dagligt → % (dagen efter sidste kørsel, dansk tid)', nxt at time zone 'Europe/Copenhagen';

  update public.company_dalux_config set schedule_mode = 'monthly', run_monthday = 1
   where company_id = c.company_id;
  select * into c from public.company_dalux_config where company_id = c.company_id;
  nxt := public.dalux_next_run(c);
  if extract(day from nxt at time zone 'Europe/Copenhagen') <> 1 then
    raise exception 'FEJL: månedlig kørsel gav %', nxt;
  end if;
  raise notice '4b ok: månedligt → %', nxt at time zone 'Europe/Copenhagen';

  update public.company_dalux_config set schedule_mode = 'manual' where company_id = c.company_id;
  select * into c from public.company_dalux_config where company_id = c.company_id;
  if public.dalux_next_run(c) is not null then raise exception 'FEJL: manuel gav en næste kørsel'; end if;
  raise notice '4c ok: manuel → ingen planlagt kørsel';
end $$;

-- 5) Gensend (B-09): kun fejlede poster, kun af egen manager, og det logges.
do $$
declare v_id uuid; v_status text; n int;
begin
  insert into public.dalux_sync_items (company_id, object_type, direction, external_id, idempotency_key, status, last_error)
  values (current_setting('operia.t_cid')::uuid, 'room', 'in', 'r-x', 'room:r-x', 'failed', 'name_conflict')
  returning id into v_id;
  -- samme nøgle igen = samme række (idempotens)
  begin
    insert into public.dalux_sync_items (company_id, object_type, direction, external_id, idempotency_key)
    values (current_setting('operia.t_cid')::uuid, 'room', 'in', 'r-x', 'room:r-x');
    raise exception 'FEJL: dublet-post blev accepteret';
  exception when unique_violation then
    raise notice '5a ok: samme idempotensnøgle giver ingen dublet';
  end;
  perform set_config('operia.t_item', v_id::text, true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', :'mgr', 'role', 'authenticated')::text, true) as _;
do $$
declare v_status text; n int;
begin
  perform public.dalux_retry_item(current_setting('operia.t_item')::uuid);
  select status into v_status from public.dalux_sync_items where id = current_setting('operia.t_item')::uuid;
  if v_status <> 'pending' then raise exception 'FEJL: gensend gav status %', v_status; end if;
  begin
    perform public.dalux_retry_item(current_setting('operia.t_item')::uuid);
    raise exception 'FEJL: en afventende post kunne gensendes igen';
  exception when sqlstate 'P0001' then null;
  end;
  select count(*) into n from public.audit_log where action = 'dalux.item_retried';
  if n < 1 then raise exception 'FEJL: gensend blev ikke logget'; end if;
  raise notice '5b ok: gensend → afventer, kun én gang, logget';
end $$;

rollback;

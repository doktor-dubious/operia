-- Fixtures: momskoden følger tingen, ikke prisen (EVU A-06/C-06).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/booking_vat_codes.sql
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
   and exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager') limit 1 \gset

do $$
declare cid uuid := current_setting('operia.t_cid')::uuid; eid uuid := current_setting('operia.t_eid')::uuid;
        cat uuid; rid uuid; lvl uuid; svc uuid; bk uuid;
begin
  insert into public.booking_categories (company_id, name, vat_code) values (cid, 'Momskat ' || substr(gen_random_uuid()::text,1,6), 'IVF') returning id into cat;
  insert into public.booking_resources (company_id, name, category_id) values (cid, 'Momslokale ' || substr(gen_random_uuid()::text,1,6), cat) returning id into rid;
  insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount, valid_from) values (cid,'resource',rid,'day',1000,'2026-01-01');
  insert into public.booking_participant_levels (company_id, name, vat_code) values (cid, 'Momsniveau', 'I0') returning id into lvl;
  insert into public.booking_tariffs (company_id, scope, level_id, unit, amount, valid_from) values (cid,'level',lvl,'person',100,'2026-01-01');
  insert into public.booking_services (company_id, name, has_quantity, price_mode, unit_price, vat_code) values (cid, 'Momsforplejning', true, 'unit', 50, 'I25') returning id into svc;
  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at, status, title, participant_count, participant_level_id)
  values (cid, rid, eid, '2026-08-17 09:00+02', '2026-08-17 16:00+02', 'booked', 'Momskursus', 10, lvl) returning id into bk;
  insert into public.booking_service_lines (company_id, booking_id, service_id, quantity, unit_price, price_mode) values (cid, bk, svc, 10, 50, 'unit');
  perform set_config('operia.t_bk', bk::text, true);
  perform set_config('operia.t_svc', svc::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'mgr', 'role','authenticated')::text, true) as _;

do $$
declare res jsonb; r record; n int := 0;
begin
  res := public.generate_invoice_draft(current_setting('operia.t_cid')::uuid, array[current_setting('operia.t_bk')::uuid]);
  for r in select source, vat_code from public.invoice_draft_lines where draft_id = (res->>'draft_id')::uuid loop
    n := n + 1;
    if r.source = 'resource' and r.vat_code is distinct from 'IVF' then raise exception 'FEJL: lokalelinje fik % (ventede IVF fra kategorien)', r.vat_code; end if;
    if r.source = 'participants' and r.vat_code is distinct from 'I0' then raise exception 'FEJL: kursistlinje fik % (ventede I0 fra niveauet)', r.vat_code; end if;
    if r.source = 'service' and r.vat_code is distinct from 'I25' then raise exception 'FEJL: tilkøbslinje fik % (ventede I25 fra ydelsen)', r.vat_code; end if;
  end loop;
  if n <> 3 then raise exception 'FEJL: ventede 3 linjer, fik %', n; end if;
  raise notice '1 ok: lokale=IVF (kategori), kursister=I0 (niveau), tilkøb=I25 (ydelse)';
end $$;

-- Ændring af momskoden på en ydelse står i sporet.
do $$
declare n int;
begin
  update public.booking_services set vat_code = 'I0' where id = current_setting('operia.t_svc')::uuid;
  select count(*) into n from public.audit_log where action = 'booking_service.vat_changed' and detail->>'to_vat' = 'I0';
  if n < 1 then raise exception 'FEJL: momsændring ikke logget'; end if;
  raise notice '2 ok: momsændring logget';
end $$;
rollback;

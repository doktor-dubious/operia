-- Fixtures: produktnummer pr. ydelse/kategori/niveau når kladdelinjen (C-02).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/economic_product_per_item.sql
\set ON_ERROR_STOP on
begin;
select a.company_id as cid, a.user_id::text as mgr from public.app_users a
 where exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
 order by a.created_at limit 1 \gset
select id as eid from public.employees where company_id = :'cid' and is_active limit 1 \gset
select set_config('operia.t_cid', :'cid', true) as _;
select set_config('operia.t_eid', :'eid', true) as _;

do $$
declare cid uuid := current_setting('operia.t_cid')::uuid; eid uuid := current_setting('operia.t_eid')::uuid;
        cat uuid; rid uuid; lvl uuid; s1 uuid; s2 uuid; bk uuid;
begin
  update public.companies set booking_retro_allowed = true where id = cid;
  insert into public.booking_categories (company_id, name, accounting_item_ref) values (cid, 'Prod-kat ' || substr(gen_random_uuid()::text,1,6), 'CAT-1') returning id into cat;
  insert into public.booking_resources (company_id, name, category_id) values (cid, 'Prod-lokale ' || substr(gen_random_uuid()::text,1,6), cat) returning id into rid;
  insert into public.booking_tariffs (company_id, scope, resource_id, unit, amount, valid_from) values (cid,'resource',rid,'day',1000,'2020-01-01');
  insert into public.booking_participant_levels (company_id, name, accounting_item_ref) values (cid, 'Prod-niveau', 'LVL-1') returning id into lvl;
  insert into public.booking_tariffs (company_id, scope, level_id, unit, amount, valid_from) values (cid,'level',lvl,'person',100,'2020-01-01');
  -- to tilkøb: ét med eget produkt, ét uden (skal falde tilbage på mapningen)
  insert into public.booking_services (company_id, name, has_quantity, price_mode, unit_price, accounting_item_ref) values (cid, 'Forplejning P', true, 'unit', 50, 'FOOD-25') returning id into s1;
  insert into public.booking_services (company_id, name, has_quantity, price_mode, unit_price) values (cid, 'Materiale P', true, 'unit', 20) returning id into s2;
  insert into public.bookings (company_id, resource_id, employee_id, starts_at, ends_at, status, title, participant_count, participant_level_id)
  values (cid, rid, eid, now() - interval '5 days', now() - interval '5 days' + interval '3 hours', 'booked', 'Prod-kursus', 10, lvl) returning id into bk;
  insert into public.booking_service_lines (company_id, booking_id, service_id, quantity, unit_price, price_mode) values (cid, bk, s1, 10, 50, 'unit'), (cid, bk, s2, 10, 20, 'unit');
  perform set_config('operia.t_bk', bk::text, true);
  perform set_config('operia.t_cat', cat::text, true); perform set_config('operia.t_lvl', lvl::text, true);
  perform set_config('operia.t_s1', s1::text, true); perform set_config('operia.t_s2', s2::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'mgr', 'role','authenticated')::text, true) as _;

-- 1) Hver linje husker, hvad den kom af — kategori, niveau, ydelse.
do $$
declare res jsonb; r record; n int := 0;
begin
  res := public.generate_invoice_draft(current_setting('operia.t_cid')::uuid, array[current_setting('operia.t_bk')::uuid]);
  for r in select source, ref_id from public.invoice_draft_lines where draft_id = (res->>'draft_id')::uuid loop
    n := n + 1;
    if r.source = 'resource' and r.ref_id is distinct from current_setting('operia.t_cat')::uuid then raise exception 'FEJL: lokalelinje peger ikke på kategorien'; end if;
    if r.source = 'participants' and r.ref_id is distinct from current_setting('operia.t_lvl')::uuid then raise exception 'FEJL: kursistlinje peger ikke på niveauet'; end if;
    if r.source = 'service' and r.ref_id not in (current_setting('operia.t_s1')::uuid, current_setting('operia.t_s2')::uuid) then raise exception 'FEJL: tilkøbslinje peger ikke på ydelsen'; end if;
  end loop;
  if n <> 4 then raise exception 'FEJL: ventede 4 linjer, fik %', n; end if;
  perform set_config('operia.t_draft', res->>'draft_id', true);
  raise notice '1 ok: 4 linjer med ref_id til kategori / niveau / to ydelser';
end $$;

-- 2) Opslaget, som overførslen laver: eget produkt vinder, ellers typeproduktet.
do $$
declare r record; own int := 0; fallback int := 0;
begin
  for r in
    select l.source,
           coalesce(s.accounting_item_ref, c.accounting_item_ref, v.accounting_item_ref) as item_product
    from public.invoice_draft_lines l
    left join public.booking_services s on s.id = l.ref_id
    left join public.booking_categories c on c.id = l.ref_id
    left join public.booking_participant_levels v on v.id = l.ref_id
    where l.draft_id = current_setting('operia.t_draft')::uuid
  loop
    if r.item_product is not null then own := own + 1; else fallback := fallback + 1; end if;
  end loop;
  if own <> 3 or fallback <> 1 then raise exception 'FEJL: % med eget produkt, % med fallback (ventede 3/1)', own, fallback; end if;
  raise notice '2 ok: CAT-1, LVL-1, FOOD-25 slås op pr. linje; Materiale falder tilbage på typeproduktet';
end $$;

-- 3) Kreditnotaen arver ref_id, så den bogføres på samme produkter.
do $$
declare d uuid := current_setting('operia.t_draft')::uuid; res jsonb; n int;
begin
  perform public.approve_invoice_draft(d, true);
  perform public.transfer_invoice_draft(d, 'F-77', 'manual', null);
  res := public.create_credit_note(d);
  select count(*) into n from public.invoice_draft_lines where draft_id = (res->>'draft_id')::uuid and ref_id is not null;
  if n <> 4 then raise exception 'FEJL: kreditnotaens linjer mangler ref_id (%)', n; end if;
  raise notice '3 ok: kreditnotaen bærer ref_id på alle 4 linjer';
end $$;
rollback;

-- Fixture for migration 20260914210000: transfer_invoice_draft tager p_detail
-- med i revisionsrækken (momstilsidesættelse), den gamle signatur er væk,
-- og integrationen har plads til den planlagte kørsels udfald.
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/economic_review_fixes.sql
\set ON_ERROR_STOP on
begin;

select a.company_id as cid, a.user_id::text as mgr from public.app_users a
 where exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
 order by a.created_at limit 1 \gset
select set_config('operia.t_cid', :'cid', true) as _;
select set_config('request.jwt.claims', json_build_object('sub', :'mgr', 'role', 'authenticated')::text, true) as _;

do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  d uuid;
  det jsonb;
  n int;
begin
  -- 1) Kun én signatur tilbage (PGRST203-værn).
  select count(*) into n from pg_proc where proname = 'transfer_invoice_draft';
  if n <> 1 then raise exception 'FEJL: % signaturer af transfer_invoice_draft', n; end if;
  if not exists (select 1 from pg_proc where proname = 'transfer_invoice_draft'
                 and pg_get_function_identity_arguments(oid) like '%p_detail jsonb') then
    raise exception 'FEJL: p_detail mangler på transfer_invoice_draft';
  end if;
  raise notice '1 ok: én signatur, med p_detail';

  -- 2) Kolonnerne til kørslens udfald, med status-værn.
  insert into public.company_accounting_config (company_id, enabled, provider, verified_at)
  values (cid, true, 'economic', now())
  on conflict (company_id) do update set enabled = true, provider = 'economic', verified_at = now();
  update public.company_accounting_config
     set sync_last_run_at = now(), sync_last_run_status = 'failed', sync_last_run_error = 'http_401'
   where company_id = cid;
  begin
    update public.company_accounting_config set sync_last_run_status = 'weird' where company_id = cid;
    raise exception 'FEJL: ugyldig sync_last_run_status blev accepteret';
  exception when check_violation then null;
  end;
  raise notice '2 ok: sync_last_run_* findes og status er begrænset';

  -- 3) p_detail flettes ind i revisionsrækken for overførslen.
  insert into public.invoice_drafts (company_id, number, status, currency)
  values (cid, 'FX-REV-1', 'approved', 'DKK') returning id into d;
  perform public.transfer_invoice_draft(d, null, 'economic', '4711',
    jsonb_build_object('vat_override', jsonb_build_object('lookup', 'ok',
      'mismatches', jsonb_build_array(jsonb_build_object('line', 1, 'product', '2010', 'operia', 'U25', 'economic', '')))));
  select detail into det from public.audit_log
   where entity_id = d::text and action = 'invoice_draft.transferred' order by created_at desc limit 1;
  if det->>'system' <> 'economic' then raise exception 'FEJL: system mangler i detail: %', det; end if;
  if det->'vat_override'->'mismatches'->0->>'product' <> '2010' then
    raise exception 'FEJL: vat_override kom ikke med i revisionsrækken: %', det;
  end if;
  raise notice '3 ok: momstilsidesættelsen står i revisionsrækken';

  -- 4) Uden p_detail (gamle kaldere) er rækken som før.
  insert into public.invoice_drafts (company_id, number, status, currency)
  values (cid, 'FX-REV-2', 'approved', 'DKK') returning id into d;
  perform public.transfer_invoice_draft(d, '1001');
  select detail into det from public.audit_log
   where entity_id = d::text and action = 'invoice_draft.transferred' order by created_at desc limit 1;
  if det <> jsonb_build_object('system', 'manual') then raise exception 'FEJL: uventet detail uden p_detail: %', det; end if;
  raise notice '4 ok: default p_detail ændrer intet';
end $$;

rollback;

-- Fixture for migration 20260914180000: service-rollen må notere et
-- fakturanummer, economic_sync_due finder de rigtige, og cron-jobbet findes.
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -f supabase/tests/economic_sync_schedule.sql
\set ON_ERROR_STOP on
begin;

select a.company_id as cid from public.app_users a
 where exists (select 1 from public.user_roles r where r.user_id = a.user_id and r.role = 'manager')
 order by a.created_at limit 1 \gset
select set_config('operia.t_cid', :'cid', true) as _;

do $$
declare
  cid uuid := current_setting('operia.t_cid')::uuid;
  d1 uuid; d2 uuid;
begin
  insert into public.company_accounting_config (company_id, enabled, provider, verified_at)
  values (cid, true, 'economic', now())
  on conflict (company_id) do update set enabled = true, provider = 'economic', verified_at = now();
  insert into public.invoice_drafts (company_id, number, status, external_system, external_id, transferred_at, currency)
  values (cid, 'FX-TEST-1', 'transferred', 'economic', '901', now() - interval '1 day', 'DKK') returning id into d1;
  insert into public.invoice_drafts (company_id, number, status, external_system, external_id, invoice_no, transferred_at, currency)
  values (cid, 'FX-TEST-2', 'transferred', 'economic', '902', '77', now() - interval '1 day', 'DKK') returning id into d2;
  perform set_config('operia.t_d1', d1::text, true);

  if not exists (select 1 from public.economic_sync_due() s where s.company_id = cid and s.pending >= 1) then
    raise exception 'FEJL: economic_sync_due ser ikke den overførte kladde uden nummer';
  end if;
  -- Basen kan have rigtige forfaldne kladder i forvejen: mål relativt.
  perform set_config('operia.t_pending',
    (select s.pending from public.economic_sync_due() s where s.company_id = cid)::text, true);
  raise notice '1 ok: economic_sync_due finder virksomheden';
end $$;

-- Service-rollen (intet auth.uid) noterer nummeret — og samme nummer igen er ingen ændring.
set local role service_role;
select set_config('request.jwt.claims', '', true) as _;
do $$
declare
  d uuid := current_setting('operia.t_d1')::uuid;
  n int;
begin
  perform public.record_invoice_booked(d, '1234');
  if (select invoice_no from public.invoice_drafts where id = d) <> '1234' then
    raise exception 'FEJL: nummeret blev ikke noteret af service-rollen';
  end if;
  select count(*) into n from public.audit_log where entity_id = d::text and action = 'invoice_draft.booked';
  perform public.record_invoice_booked(d, '1234');
  if (select count(*) from public.audit_log where entity_id = d::text and action = 'invoice_draft.booked') <> n then
    raise exception 'FEJL: samme nummer igen gav en ny revisionsrække';
  end if;
  if (select detail->>'source' from public.audit_log where entity_id = d::text and action = 'invoice_draft.booked' limit 1) <> 'scheduled' then
    raise exception 'FEJL: revisionsrækken skal sige scheduled uden bruger';
  end if;
  raise notice '2 ok: service-rollen noterer; idempotent; source=scheduled';
end $$;
reset role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'operia-economic-sync') then
    raise exception 'FEJL: cron-jobbet operia-economic-sync findes ikke';
  end if;
  if coalesce((select s.pending from public.economic_sync_due() s where s.company_id = current_setting('operia.t_cid')::uuid), 0)
     <> current_setting('operia.t_pending')::int - 1 then
    raise exception 'FEJL: den noterede kladde tæller stadig som forfalden';
  end if;
  raise notice '3 ok: cron-job findes; den noterede kladde er ikke længere forfalden';
end $$;

rollback;

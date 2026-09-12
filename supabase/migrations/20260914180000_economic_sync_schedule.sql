-- Fakturanummeret hentes af sig selv (C-02): e-conomic siger ikke til, når
-- bogholderen bogfører, og indtil nu kom nummeret kun hjem, når nogen trykkede
-- "Hent fakturanummer". Nu kører et cron-job hver time og henter det for
-- alle overførte kladder uden nummer — og skærmen henter, når en sådan kladde
-- åbnes (web). Bogholderen kan altså stadig arbejde i e-conomic alene.
--
-- 1) record_invoice_booked må kaldes af service-rollen (intet auth.uid):
--    cron-jobbet har ingen bruger. Samme mønster som log_booking_export.
-- 2) economic_sync_due(): virksomhederne med noget at hente — én kald pr.
--    virksomhed, ikke pr. kladde, så e-conomic ikke belastes unødigt.
-- 3) cron 'operia-economic-sync': hvert kvarter efter hel time, kun de
--    forfaldne.

create or replace function public.record_invoice_booked(p_draft_id uuid, p_invoice_no text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d record;
  v_no text := nullif(btrim(coalesce(p_invoice_no, '')), '');
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then raise exception 'draft_not_found' using errcode = 'P0002'; end if;
  -- Service-rollen (cron) har intet auth.uid og er tjekket af edge-funktionen.
  if auth.uid() is not null and not public.can_invoice_bookings(d.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if d.status <> 'transferred' then raise exception 'draft_not_transferred' using errcode = 'P0001'; end if;
  if v_no is null then raise exception 'invoice_no_required' using errcode = 'P0001'; end if;
  -- Idempotent: samme nummer igen er ikke en ændring (cron og klik kan krydse).
  if d.invoice_no = v_no then return; end if;
  update public.invoice_drafts set invoice_no = v_no where id = p_draft_id;
  perform public.record_audit(d.company_id, 'invoice_draft.booked', 'invoice_draft',
    p_draft_id::text, d.number,
    jsonb_build_object('invoice_no', v_no, 'system', d.external_system,
                       'source', case when auth.uid() is null then 'scheduled' else 'user' end));
end;
$function$;
grant execute on function public.record_invoice_booked(uuid, text) to authenticated, service_role;

-- Virksomheder med overførte e-conomic-kladder uden fakturanummer, hvor
-- integrationen stadig er slået til og verificeret. Kun for service-rollen.
create or replace function public.economic_sync_due()
returns table (company_id uuid, pending integer)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select d.company_id, count(*)::int
  from public.invoice_drafts d
  join public.company_accounting_config c on c.company_id = d.company_id
  where d.status = 'transferred'
    and d.external_system = 'economic'
    and d.invoice_no is null
    and c.enabled and c.provider = 'economic' and c.verified_at is not null
  group by d.company_id
$fn$;
revoke all on function public.economic_sync_due() from public;
grant execute on function public.economic_sync_due() to service_role;

-- Cron: hver time, 7 minutter over, kun virksomheder med noget at hente.
select cron.unschedule('operia-economic-sync')
  where exists (select 1 from cron.job where jobname = 'operia-economic-sync');
select cron.schedule('operia-economic-sync', '7 * * * *', $job$
do $inner$
declare v_key text; r record;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return; end if;
  for r in select * from public.economic_sync_due() loop
    perform net.http_post(
      url := 'https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/economic-sync-run',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('companyId', r.company_id, 'trigger', 'scheduled')
    );
  end loop;
end
$inner$;
$job$);

-- Rigere gateway-hændelseslogning + async import.
-- 1) 'processing'-status: sat mens den asynkrone import kører (observerbarhed).
-- 2) log_gateway_event: kontrolleret indgang så SFTPGo-hændelser (login, download,
--    delete, rename) kan skrives til audit-loggen fra edge-funktionerne uden at
--    give service-role direkte adgang til record_audit.

alter table public.inbound_files drop constraint inbound_files_status_check;
alter table public.inbound_files
  add constraint inbound_files_status_check
  check (status in ('received', 'processing', 'processed', 'rejected', 'failed'));

create or replace function public.log_gateway_event(
  p_company_id uuid,
  p_action text,
  p_summary text,
  p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_audit(p_company_id, p_action, 'data_transfer', p_company_id::text,
    p_summary, coalesce(p_detail, '{}'::jsonb));
end;
$$;

revoke execute on function public.log_gateway_event(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_gateway_event(uuid, text, text, jsonb) to service_role;

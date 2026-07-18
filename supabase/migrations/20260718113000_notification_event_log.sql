-- Fejl (og kvitteringer) fra notifikations-afsendelse skal kunne ses i Logs.
--
-- 1) log_notification_event: SECURITY DEFINER-bro så de service-role-kørte
--    dispatchere/send-funktioner kan skrive til den ellers trigger-kun-skrivbare
--    audit_log — samme mønster som log_gateway_event (20260714120000). Bevarer
--    invarianten "audit_log skrives kun af definer-funktioner": browseren kan
--    stadig ikke forfalske poster.
create or replace function public.log_notification_event(
  p_company_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_summary text,
  p_detail jsonb default '{}'::jsonb,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_audit(
    p_company_id, p_action, p_entity_type, p_entity_id, p_summary,
    coalesce(p_detail, '{}'::jsonb), p_actor
  );
end;
$$;

revoke execute on function public.log_notification_event(uuid, text, text, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.log_notification_event(uuid, text, text, text, text, jsonb, uuid)
  to service_role;

-- 2) Niveau-udledningen generaliseres: ENHVER handling der ender på '.failed' er
--    en teknisk fejl → 'error' (dækker nu import.failed OG de nye
--    asset.reminder_failed / parcel.reminder_failed, samt fremtidige). Resten
--    uændret. audit_log.level er en genereret kolonne over denne funktion, så
--    nye poster får niveauet automatisk. Klientspejlet er levelOf i
--    web/src/routes/_app/operia.logs.tsx — holdt i sync.
create or replace function public.audit_level(p_action text, p_detail jsonb)
returns text language sql immutable as $$
  select case
    when p_action like '%.failed' or p_action = 'data_transfer.spoof_rejected' then 'error'
    when p_action = 'import.rejected'
      or p_action like '%.deleted'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned'))
      then 'warning'
    else 'success'
  end
$$;

-- Defense-in-depth for e-mail-ingest: en mislykket afsenderverifikation
-- (DKIM/SPF/DMARC — mulig spoofing) logges som en SIKKERHEDShændelse på
-- ERROR-niveau. email-inbound skriver 'data_transfer.spoof_rejected' via
-- log_gateway_event; her udvides niveau-udledningen så den bliver 'error'
-- (samme alvor som en teknisk import.failed), så den lyser rødt i Logs.
create or replace function public.audit_level(p_action text, p_detail jsonb)
returns text language sql immutable as $$
  select case
    when p_action in ('import.failed', 'data_transfer.spoof_rejected') then 'error'
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

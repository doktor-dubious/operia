-- Rettelse til 20260718113000: mønsteret '%.failed' fangede kun handlinger med
-- et PUNKTUM før 'failed' (import.failed), men de nye afsendelsesfejl hedder
-- 'asset.reminder_failed' / 'parcel.reminder_failed' — UNDERSTREG før 'failed'.
-- Match derfor begge endelser ('.failed' og '_failed'), så alle tekniske fejl
-- lyser rødt i Logs. audit_log.level er en genereret kolonne over funktionen.
create or replace function public.audit_level(p_action text, p_detail jsonb)
returns text language sql immutable as $$
  select case
    when p_action like '%.failed'
      or p_action like '%\_failed' escape '\'
      or p_action = 'data_transfer.spoof_rejected'
      then 'error'
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

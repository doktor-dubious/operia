-- E-mail-leveringsudfald fra Resend-webhooken skal lyse i Logs:
--   • et hårdt bounce (ukendt postkasse m.m.) er en teknisk fejl → 'error'
--     (handlinger på '%_bounced'/'%.bounced', fx asset.reminder_bounced,
--     parcel.notification_bounced).
--   • en spam-klage ('complained') er ikke en teknisk fejl, men fortjener
--     opmærksomhed (afsender-omdømme) → 'warning'.
-- audit_log.level er en genereret kolonne over denne funktion. Klientspejlet er
-- levelOf i web/src/routes/_app/operia.logs.tsx — holdt i sync.
create or replace function public.audit_level(p_action text, p_detail jsonb)
returns text language sql immutable as $$
  select case
    when p_action like '%.failed' or p_action like '%\_failed' escape '\'
      or p_action like '%.bounced' or p_action like '%\_bounced' escape '\'
      or p_action = 'data_transfer.spoof_rejected'
      then 'error'
    when p_action = 'import.rejected'
      or p_action like '%.deleted'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or p_action like '%.complained' or p_action like '%\_complained' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned'))
      then 'warning'
    else 'success'
  end
$$;

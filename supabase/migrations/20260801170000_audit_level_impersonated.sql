-- ---------------------------------------------------------------------------
-- Logniveau: 'user.impersonated' — en platform-admin overtager en anden brugers
-- session — er per definition en undtagelse og skal lyse gult i Logs, ikke stå
-- som rutinemæssig succes. Det er den hændelse en NIS2/GDPR-gennemgang leder
-- efter først, så den må ikke gemme sig blandt de grønne linjer.
--
-- Bemærk: den er en advarsel, ikke en fejl — selve overtagelsen er en tilladt,
-- autoriseret handling (kun platform-admins, og edge-funktionen afbryder hvis
-- den ikke kan audit-logges). Fejl-niveauet er reserveret til noget der gik galt.
--
-- audit_log.level er en genereret kolonne over denne funktion (kun nye rækker
-- beregnes om — de hidtidige impersonation-rækker beholder 'success' i
-- kolonnen); klientspejlet er levelOf i web/src/routes/_app/operia.logs.tsx —
-- holdt i sync, og det er dét, Logs-skærmen farver og filtrerer efter, så
-- ældre rækker vises også som advarsel.
-- ---------------------------------------------------------------------------
create or replace function public.audit_level(p_action text, p_detail jsonb)
returns text language sql immutable as $$
  select case
    when p_action = 'parcel.removed'
      or p_action like '%.failed' or p_action like '%\_failed' escape '\'
      or p_action like '%.bounced' or p_action like '%\_bounced' escape '\'
      or p_action = 'data_transfer.spoof_rejected'
      then 'error'
    when p_action = 'import.rejected'
      or p_action = 'user.impersonated'
      or p_action like '%.deleted'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or p_action like '%.written\_off' escape '\'
      or p_action like '%.overridden' or p_action like '%\_overridden' escape '\'
      or p_action like '%.complained' or p_action like '%\_complained' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned', 'removed'))
      then 'warning'
    else 'success'
  end
$$;

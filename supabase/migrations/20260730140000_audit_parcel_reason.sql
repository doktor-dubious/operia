-- Manager-begrundelsen med i revisionsloggen.
--
-- Overstyring af modtageren og fjernelse af en fejlregistreret pakke er de to
-- steder hvor et menneske bevidst afviger fra det normale flow. Begrundelsen har
-- hidtil kun stået på pakken og i parcel_events; loggen viste alene
-- statusskiftet. Det gør en revision til et opslagsarbejde — hvorfor står i en
-- anden tabel end hvad. Begrundelsen kopieres derfor med ind i audit_log.detail
-- for netop de to hændelser.
--
-- GDPR-afvejning (§9 i docs/compliance-map.md): begrundelsen er managerens
-- fritekst og kan nævne en person ("N.N. er fratrådt"). audit_log er
-- uforanderlig og kan kun tømmes af den aldersbaserede purge, så dette er en
-- bevidst udvidelse af persondata i loggen — valgt fordi begrundelsen ER
-- revisionssporet for en undtagelse. Alle andre hændelsestyper er uændret
-- minimerede (kun from_status/to_status).
create or replace function public.audit_parcel_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit(
    new.company_id,
    'parcel.' || new.event_type,
    'parcel',
    new.parcel_id::text,
    null,
    jsonb_build_object('from_status', new.from_status, 'to_status', new.to_status)
      || case
           when new.event_type in ('receiver_overridden', 'removed')
                and nullif(btrim(coalesce(new.detail->>'reason', '')), '') is not null
           then jsonb_build_object('reason', new.detail->>'reason')
           else '{}'::jsonb
         end,
    new.actor_user_id
  );
  return new;
end;
$$;

-- Revisionslog for forsendelsesaftaler (Operia → Fragtfirmaer): oprettelse,
-- (de)aktivering, sletning og nøgleskift. Platform-hændelser (company_id er
-- null) — ses derfor kun af platform-admins via audit_log's RLS. Nøgleskift
-- logges uden nogensinde at røre selve nøgleværdien.
create or replace function public.audit_carrier_agreements()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text;
begin
  if tg_op = 'INSERT' then
    label := coalesce(new.name, new.provider);
    perform public.record_audit(null, 'agreement.created', 'carrier_agreement', new.id::text, label,
      jsonb_build_object('provider', new.provider, 'type', new.agreement_type));
    return new;
  elsif tg_op = 'UPDATE' then
    label := coalesce(new.name, new.provider);
    if old.is_active and not new.is_active then
      perform public.record_audit(null, 'agreement.deactivated', 'carrier_agreement', new.id::text, label);
    elsif not old.is_active and new.is_active then
      perform public.record_audit(null, 'agreement.activated', 'carrier_agreement', new.id::text, label);
    end if;
    if new.api_key is distinct from old.api_key then
      perform public.record_audit(null, 'agreement.key_replaced', 'carrier_agreement', new.id::text, label);
    end if;
    return new;
  else
    label := coalesce(old.name, old.provider);
    perform public.record_audit(null, 'agreement.deleted', 'carrier_agreement', old.id::text, label);
    return old;
  end if;
end;
$$;

create trigger audit_carrier_agreements_trg
  after insert or update or delete on public.carrier_agreements
  for each row execute function public.audit_carrier_agreements();

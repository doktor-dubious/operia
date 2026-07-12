-- Forsendelse & fakturering (prototypens "Shipping & billing"):
--  - Marginmodel: Operia ejer fragtaftalen; kundepris = kostpris × (1 + pct)
--    + fast beløb.
--  - BYOC: kundens egen fragtaftale; der faktureres abonnement og/eller
--    gebyr pr. forsendelse.
-- Platformen har standarderne; virksomheder kan override (null = arv, sættes
-- som samlet gruppe). Kundens egne aftaler (BYOC) genbruger
-- carrier_agreements med company_id sat (null = DCA's egne).

alter table public.platform_settings
  add column shipping_model text not null default 'margin'
    check (shipping_model in ('margin', 'byoc')),
  add column shipping_margin_percent numeric not null default 0 check (shipping_margin_percent >= 0),
  add column shipping_margin_fixed numeric not null default 0 check (shipping_margin_fixed >= 0),
  add column shipping_byoc_subscription numeric not null default 0 check (shipping_byoc_subscription >= 0),
  add column shipping_byoc_fee numeric not null default 0 check (shipping_byoc_fee >= 0);

alter table public.companies
  add column shipping_model text check (shipping_model in ('margin', 'byoc')),
  add column shipping_margin_percent numeric check (shipping_margin_percent >= 0),
  add column shipping_margin_fixed numeric check (shipping_margin_fixed >= 0),
  add column shipping_byoc_subscription numeric check (shipping_byoc_subscription >= 0),
  add column shipping_byoc_fee numeric check (shipping_byoc_fee >= 0);

-- Kundens egne aftaler: company_id på carrier_agreements (null = DCA's egne).
alter table public.carrier_agreements
  add column company_id uuid references public.companies (id) on delete cascade;

-- Egen virksomhed må læse sine aftaler (nøglen er stadig ulæselig via
-- kolonne-grants); skrivning er fortsat kun platform-admins.
create policy carrier_agreements_company_select on public.carrier_agreements
  for select to authenticated
  using (company_id = public.current_company_id());

grant select (company_id) on public.carrier_agreements to authenticated;
grant insert (company_id) on public.carrier_agreements to authenticated;

-- Revisionsloggen skal bære virksomheden for kundens aftaler.
create or replace function public.audit_carrier_agreements()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text;
begin
  if tg_op = 'INSERT' then
    label := coalesce(new.name, new.provider);
    perform public.record_audit(new.company_id, 'agreement.created', 'carrier_agreement', new.id::text, label,
      jsonb_build_object('provider', new.provider, 'type', new.agreement_type));
    return new;
  elsif tg_op = 'UPDATE' then
    label := coalesce(new.name, new.provider);
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'agreement.deactivated', 'carrier_agreement', new.id::text, label);
    elsif not old.is_active and new.is_active then
      perform public.record_audit(new.company_id, 'agreement.activated', 'carrier_agreement', new.id::text, label);
    end if;
    if new.api_key is distinct from old.api_key then
      perform public.record_audit(new.company_id, 'agreement.key_replaced', 'carrier_agreement', new.id::text, label);
    end if;
    return new;
  else
    label := coalesce(old.name, old.provider);
    perform public.record_audit(old.company_id, 'agreement.deleted', 'carrier_agreement', old.id::text, label);
    return old;
  end if;
end;
$$;

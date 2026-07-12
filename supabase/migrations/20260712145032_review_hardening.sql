-- Hærdning efter kodegennemgang (fire fund):
--  1) companies_manager_update er en fuld-række-UPDATE, og RLS kan ikke
--     skelne kolonner — en manager kunne PATCH'e DCA-ejede kolonner
--     (is_active + forsendelsesmodellen der faktureres efter) udenom UI'et.
--     Samme trigger-løsning og undtagelser som protect_company_identity.
--  2) has_feature() tjekkede hverken at moderproduktet stadig er enabled i
--     kataloget eller at virksomheden stadig har produktet — et deaktiveret/
--     frataget produkt lod alle sine tildelte funktioner virke videre.
--  3) carrier_agreements-læsning for egen virksomhed gjaldt alle brugere;
--     fragtkontonumre og API-brugernavne er fakturerings-nære data og
--     strammes til managers (skrivning var allerede platform-admin-only).
--  4) Forsendelses-/faktureringsfelterne og pakkeflow-indstillingerne
--     (påmindelser + stilletid) var de eneste konfigurationsområder i
--     batchen uden audit-triggere — netop dem en omtvistet takstændring
--     skal kunne spores på (NIS2).

-- 1) DCA-ejede companies-kolonner beskyttes mod managers.
create or replace function public.protect_company_dca_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.is_active is distinct from old.is_active
      or new.shipping_model is distinct from old.shipping_model
      or new.shipping_margin_percent is distinct from old.shipping_margin_percent
      or new.shipping_margin_fixed is distinct from old.shipping_margin_fixed
      or new.shipping_byoc_subscription is distinct from old.shipping_byoc_subscription
      or new.shipping_byoc_fee is distinct from old.shipping_byoc_fee)
    -- Service-rollen (Edge Functions) har ingen auth.uid() og er undtaget;
    -- anon når aldrig hertil (ingen update-politik for anon).
    and auth.uid() is not null
    and not public.is_platform_admin() then
    raise exception 'Kun platform-admins kan ændre virksomhedens status og forsendelsesmodel.';
  end if;
  return new;
end;
$$;

create trigger companies_protect_dca_columns
  before update on public.companies
  for each row execute function public.protect_company_dca_columns();

-- 2) has_feature kræver nu også et aktivt, gyldigt moderprodukt.
create or replace function public.has_feature(f text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.company_features cf
    join public.feature_catalog fc on fc.key = cf.feature_key
    join public.product_catalog pc on pc.key = fc.product_key
    join public.company_products cp
      on cp.company_id = cf.company_id and cp.product_key = fc.product_key
    where cf.company_id = public.current_company_id()
      and cf.feature_key = f
      and fc.enabled
      and pc.enabled
      and (cf.valid_until is null or cf.valid_until >= current_date)
      and (cp.valid_until is null or cp.valid_until >= current_date)
  );
$$;

-- 3) Kun managers må læse egen virksomheds fragtaftaler.
drop policy carrier_agreements_company_select on public.carrier_agreements;

create policy carrier_agreements_company_select on public.carrier_agreements
  for select to authenticated
  using (company_id = public.current_company_id() and public.has_role('manager'));

-- 4) Revisionslog: forsendelsesmodel + pakkeflow (grupperne sættes samlet i
--    UI'et, så der logges én hændelse pr. gruppe med fra/til).
create or replace function public.audit_company_billing_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.shipping_model, new.shipping_margin_percent, new.shipping_margin_fixed,
      new.shipping_byoc_subscription, new.shipping_byoc_fee)
     is distinct from
     (old.shipping_model, old.shipping_margin_percent, old.shipping_margin_fixed,
      old.shipping_byoc_subscription, old.shipping_byoc_fee) then
    perform public.record_audit(new.id, 'shipping.changed', 'company', new.id::text, new.name,
      jsonb_build_object(
        'from', jsonb_build_object('model', old.shipping_model,
          'margin_percent', old.shipping_margin_percent, 'margin_fixed', old.shipping_margin_fixed,
          'byoc_subscription', old.shipping_byoc_subscription, 'byoc_fee', old.shipping_byoc_fee),
        'to', jsonb_build_object('model', new.shipping_model,
          'margin_percent', new.shipping_margin_percent, 'margin_fixed', new.shipping_margin_fixed,
          'byoc_subscription', new.shipping_byoc_subscription, 'byoc_fee', new.shipping_byoc_fee)));
  end if;
  if (new.quiet_hours_start, new.quiet_hours_end,
      new.parcel_reminder_1_days, new.parcel_reminder_2_days,
      new.parcel_reminder_1_enabled, new.parcel_reminder_2_enabled)
     is distinct from
     (old.quiet_hours_start, old.quiet_hours_end,
      old.parcel_reminder_1_days, old.parcel_reminder_2_days,
      old.parcel_reminder_1_enabled, old.parcel_reminder_2_enabled) then
    perform public.record_audit(new.id, 'parcel_flow.changed', 'company', new.id::text, new.name,
      jsonb_build_object(
        'from', jsonb_build_object('quiet_start', old.quiet_hours_start, 'quiet_end', old.quiet_hours_end,
          'reminder_1_days', old.parcel_reminder_1_days, 'reminder_2_days', old.parcel_reminder_2_days,
          'reminder_1_enabled', old.parcel_reminder_1_enabled, 'reminder_2_enabled', old.parcel_reminder_2_enabled),
        'to', jsonb_build_object('quiet_start', new.quiet_hours_start, 'quiet_end', new.quiet_hours_end,
          'reminder_1_days', new.parcel_reminder_1_days, 'reminder_2_days', new.parcel_reminder_2_days,
          'reminder_1_enabled', new.parcel_reminder_1_enabled, 'reminder_2_enabled', new.parcel_reminder_2_enabled)));
  end if;
  return new;
end;
$$;

create or replace function public.audit_platform_billing_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.shipping_model, new.shipping_margin_percent, new.shipping_margin_fixed,
      new.shipping_byoc_subscription, new.shipping_byoc_fee)
     is distinct from
     (old.shipping_model, old.shipping_margin_percent, old.shipping_margin_fixed,
      old.shipping_byoc_subscription, old.shipping_byoc_fee) then
    perform public.record_audit(null, 'shipping.changed', 'platform_settings', 'platform', null,
      jsonb_build_object(
        'from', jsonb_build_object('model', old.shipping_model,
          'margin_percent', old.shipping_margin_percent, 'margin_fixed', old.shipping_margin_fixed,
          'byoc_subscription', old.shipping_byoc_subscription, 'byoc_fee', old.shipping_byoc_fee),
        'to', jsonb_build_object('model', new.shipping_model,
          'margin_percent', new.shipping_margin_percent, 'margin_fixed', new.shipping_margin_fixed,
          'byoc_subscription', new.shipping_byoc_subscription, 'byoc_fee', new.shipping_byoc_fee)));
  end if;
  if (new.quiet_hours_start, new.quiet_hours_end,
      new.parcel_reminder_1_days, new.parcel_reminder_2_days,
      new.parcel_reminder_1_enabled, new.parcel_reminder_2_enabled)
     is distinct from
     (old.quiet_hours_start, old.quiet_hours_end,
      old.parcel_reminder_1_days, old.parcel_reminder_2_days,
      old.parcel_reminder_1_enabled, old.parcel_reminder_2_enabled) then
    perform public.record_audit(null, 'parcel_flow.changed', 'platform_settings', 'platform', null,
      jsonb_build_object(
        'from', jsonb_build_object('quiet_start', old.quiet_hours_start, 'quiet_end', old.quiet_hours_end,
          'reminder_1_days', old.parcel_reminder_1_days, 'reminder_2_days', old.parcel_reminder_2_days,
          'reminder_1_enabled', old.parcel_reminder_1_enabled, 'reminder_2_enabled', old.parcel_reminder_2_enabled),
        'to', jsonb_build_object('quiet_start', new.quiet_hours_start, 'quiet_end', new.quiet_hours_end,
          'reminder_1_days', new.parcel_reminder_1_days, 'reminder_2_days', new.parcel_reminder_2_days,
          'reminder_1_enabled', new.parcel_reminder_1_enabled, 'reminder_2_enabled', new.parcel_reminder_2_enabled)));
  end if;
  return new;
end;
$$;

create trigger audit_company_billing_settings_trg
  after update on public.companies
  for each row execute function public.audit_company_billing_settings();

create trigger audit_platform_billing_settings_trg
  after update on public.platform_settings
  for each row execute function public.audit_platform_billing_settings();

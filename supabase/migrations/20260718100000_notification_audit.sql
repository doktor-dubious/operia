-- Revisionslog for notifikations-konfiguration (NIS2). De eksisterende
-- billing_settings-triggere (20260712145032) loggede allerede stilletid +
-- pakkepåmindelse 1/2 som 'parcel_flow.changed', men IKKE: parcel_reminder_max,
-- kanalvalg (notify_email/sms), hovedafbryderne, eller de nye aktiv-påmindelser.
-- Derfor gav en ændring af fx en kanal eller aktiv-påmindelse ingen log-linje.
--
-- Her udvides trigger-funktionerne (create or replace — triggerne selv består):
--   • 'parcel_flow.changed' dækker nu også parcel_reminder_max, e-mail/SMS-kanal
--     og (platform) parcel_notifications_enabled.
--   • nyt 'asset_flow.changed' dækker aktiv-påmindelserne + (platform)
--     asset_notifications_enabled.
-- Begge felters fra/til lægges i detail som hidtil.

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
      new.parcel_reminder_1_enabled, new.parcel_reminder_2_enabled,
      new.parcel_reminder_max, new.notify_email_enabled, new.notify_sms_enabled)
     is distinct from
     (old.quiet_hours_start, old.quiet_hours_end,
      old.parcel_reminder_1_days, old.parcel_reminder_2_days,
      old.parcel_reminder_1_enabled, old.parcel_reminder_2_enabled,
      old.parcel_reminder_max, old.notify_email_enabled, old.notify_sms_enabled) then
    perform public.record_audit(new.id, 'parcel_flow.changed', 'company', new.id::text, new.name,
      jsonb_build_object(
        'from', jsonb_build_object('quiet_start', old.quiet_hours_start, 'quiet_end', old.quiet_hours_end,
          'reminder_1_days', old.parcel_reminder_1_days, 'reminder_2_days', old.parcel_reminder_2_days,
          'reminder_1_enabled', old.parcel_reminder_1_enabled, 'reminder_2_enabled', old.parcel_reminder_2_enabled,
          'reminder_max', old.parcel_reminder_max, 'email', old.notify_email_enabled, 'sms', old.notify_sms_enabled),
        'to', jsonb_build_object('quiet_start', new.quiet_hours_start, 'quiet_end', new.quiet_hours_end,
          'reminder_1_days', new.parcel_reminder_1_days, 'reminder_2_days', new.parcel_reminder_2_days,
          'reminder_1_enabled', new.parcel_reminder_1_enabled, 'reminder_2_enabled', new.parcel_reminder_2_enabled,
          'reminder_max', new.parcel_reminder_max, 'email', new.notify_email_enabled, 'sms', new.notify_sms_enabled)));
  end if;

  if (new.asset_reminder_1_days, new.asset_reminder_2_days,
      new.asset_reminder_1_enabled, new.asset_reminder_2_enabled, new.asset_reminder_max)
     is distinct from
     (old.asset_reminder_1_days, old.asset_reminder_2_days,
      old.asset_reminder_1_enabled, old.asset_reminder_2_enabled, old.asset_reminder_max) then
    perform public.record_audit(new.id, 'asset_flow.changed', 'company', new.id::text, new.name,
      jsonb_build_object(
        'from', jsonb_build_object('reminder_1_days', old.asset_reminder_1_days, 'reminder_2_days', old.asset_reminder_2_days,
          'reminder_1_enabled', old.asset_reminder_1_enabled, 'reminder_2_enabled', old.asset_reminder_2_enabled,
          'reminder_max', old.asset_reminder_max),
        'to', jsonb_build_object('reminder_1_days', new.asset_reminder_1_days, 'reminder_2_days', new.asset_reminder_2_days,
          'reminder_1_enabled', new.asset_reminder_1_enabled, 'reminder_2_enabled', new.asset_reminder_2_enabled,
          'reminder_max', new.asset_reminder_max)));
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
      new.parcel_reminder_1_enabled, new.parcel_reminder_2_enabled,
      new.parcel_reminder_max, new.notify_email_enabled, new.notify_sms_enabled,
      new.parcel_notifications_enabled)
     is distinct from
     (old.quiet_hours_start, old.quiet_hours_end,
      old.parcel_reminder_1_days, old.parcel_reminder_2_days,
      old.parcel_reminder_1_enabled, old.parcel_reminder_2_enabled,
      old.parcel_reminder_max, old.notify_email_enabled, old.notify_sms_enabled,
      old.parcel_notifications_enabled) then
    perform public.record_audit(null, 'parcel_flow.changed', 'platform_settings', 'platform', null,
      jsonb_build_object(
        'from', jsonb_build_object('quiet_start', old.quiet_hours_start, 'quiet_end', old.quiet_hours_end,
          'reminder_1_days', old.parcel_reminder_1_days, 'reminder_2_days', old.parcel_reminder_2_days,
          'reminder_1_enabled', old.parcel_reminder_1_enabled, 'reminder_2_enabled', old.parcel_reminder_2_enabled,
          'reminder_max', old.parcel_reminder_max, 'email', old.notify_email_enabled, 'sms', old.notify_sms_enabled,
          'enabled', old.parcel_notifications_enabled),
        'to', jsonb_build_object('quiet_start', new.quiet_hours_start, 'quiet_end', new.quiet_hours_end,
          'reminder_1_days', new.parcel_reminder_1_days, 'reminder_2_days', new.parcel_reminder_2_days,
          'reminder_1_enabled', new.parcel_reminder_1_enabled, 'reminder_2_enabled', new.parcel_reminder_2_enabled,
          'reminder_max', new.parcel_reminder_max, 'email', new.notify_email_enabled, 'sms', new.notify_sms_enabled,
          'enabled', new.parcel_notifications_enabled)));
  end if;

  if (new.asset_reminder_1_days, new.asset_reminder_2_days,
      new.asset_reminder_1_enabled, new.asset_reminder_2_enabled, new.asset_reminder_max,
      new.asset_notifications_enabled)
     is distinct from
     (old.asset_reminder_1_days, old.asset_reminder_2_days,
      old.asset_reminder_1_enabled, old.asset_reminder_2_enabled, old.asset_reminder_max,
      old.asset_notifications_enabled) then
    perform public.record_audit(null, 'asset_flow.changed', 'platform_settings', 'platform', null,
      jsonb_build_object(
        'from', jsonb_build_object('reminder_1_days', old.asset_reminder_1_days, 'reminder_2_days', old.asset_reminder_2_days,
          'reminder_1_enabled', old.asset_reminder_1_enabled, 'reminder_2_enabled', old.asset_reminder_2_enabled,
          'reminder_max', old.asset_reminder_max, 'enabled', old.asset_notifications_enabled),
        'to', jsonb_build_object('reminder_1_days', new.asset_reminder_1_days, 'reminder_2_days', new.asset_reminder_2_days,
          'reminder_1_enabled', new.asset_reminder_1_enabled, 'reminder_2_enabled', new.asset_reminder_2_enabled,
          'reminder_max', new.asset_reminder_max, 'enabled', new.asset_notifications_enabled)));
  end if;
  return new;
end;
$$;

-- Kategorisér 'asset_flow' under 'assets' (parcel_flow er allerede 'parcels').
-- Fuld genskabelse så den er den kanoniske afbildning; 'general' genindsat
-- (droppet ved en fejl i 20260717100000). Klientspejlet er categoryOf i
-- web/src/routes/_app/operia.logs.tsx — hold i sync.
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $$
  select case split_part(coalesce(p_action, ''), '.', 1)
    when 'parcel'         then 'parcels'
    when 'parcel_flow'    then 'parcels'
    when 'employee'       then 'directory'
    when 'department'     then 'directory'
    when 'location'       then 'config'
    when 'handling_class' then 'config'
    when 'carrier'        then 'config'
    when 'general'        then 'config'
    when 'shipping'       then 'shipping'
    when 'agreement'      then 'shipping'
    when 'asset'          then 'assets'
    when 'asset_category' then 'assets'
    when 'asset_location' then 'assets'
    when 'asset_flow'     then 'assets'
    when 'assets'         then 'assets'
    when 'inventory_item' then 'inventory'
    when 'locker'         then 'lockers'
    when 'user'           then 'access'
    when 'product'        then 'entitlements'
    when 'feature'        then 'entitlements'
    when 'template'       then 'branding'
    when 'language'       then 'branding'
    when 'currency'       then 'branding'
    when 'appearance'     then 'branding'
    when 'product_text'   then 'branding'
    when 'home'           then 'branding'
    when 'handheld'       then 'branding'
    when 'maps'           then 'maps'
    when 'route'          then 'maps'
    when 'import'         then 'imports'
    when 'import_config'  then 'imports'
    when 'data_transfer'  then 'imports'
    when 'log_drain'      then 'log'
    when 'retention'      then 'log'
    else 'other'
  end
$$;

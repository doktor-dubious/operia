-- Ankomstbesked som egen notifikation ("Besked ved ankomst"): hidtil sendte
-- pakke-dispatcheren ALTID ankomstbeskeden når hovedafbryderen + en kanal var
-- tændt — der fandtes ingen egen kontakt for den (kun påmindelse 1/2 havde
-- toggles). Nu: platform-standard + virksomheds-override (null = arv), samme
-- mønster som påmindelses-togglerne (20260712061904). Default true = uændret
-- adfærd; hovedafbryderen parcel_notifications_enabled gater stadig alt.
alter table public.platform_settings
  add column parcel_arrival_enabled boolean not null default true;

alter table public.companies
  add column parcel_arrival_enabled boolean;

-- Revisionslog (NIS2): ankomst-togglen skal give en 'parcel_flow.changed'-linje
-- som de øvrige notifikationsfelter. Begge trigger-funktioner udvides
-- (create or replace — triggerne selv består, jf. 20260718100000).
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
      new.parcel_reminder_max, new.notify_email_enabled, new.notify_sms_enabled,
      new.parcel_arrival_enabled)
     is distinct from
     (old.quiet_hours_start, old.quiet_hours_end,
      old.parcel_reminder_1_days, old.parcel_reminder_2_days,
      old.parcel_reminder_1_enabled, old.parcel_reminder_2_enabled,
      old.parcel_reminder_max, old.notify_email_enabled, old.notify_sms_enabled,
      old.parcel_arrival_enabled) then
    perform public.record_audit(new.id, 'parcel_flow.changed', 'company', new.id::text, new.name,
      jsonb_build_object(
        'from', jsonb_build_object('quiet_start', old.quiet_hours_start, 'quiet_end', old.quiet_hours_end,
          'reminder_1_days', old.parcel_reminder_1_days, 'reminder_2_days', old.parcel_reminder_2_days,
          'reminder_1_enabled', old.parcel_reminder_1_enabled, 'reminder_2_enabled', old.parcel_reminder_2_enabled,
          'reminder_max', old.parcel_reminder_max, 'email', old.notify_email_enabled, 'sms', old.notify_sms_enabled,
          'arrival', old.parcel_arrival_enabled),
        'to', jsonb_build_object('quiet_start', new.quiet_hours_start, 'quiet_end', new.quiet_hours_end,
          'reminder_1_days', new.parcel_reminder_1_days, 'reminder_2_days', new.parcel_reminder_2_days,
          'reminder_1_enabled', new.parcel_reminder_1_enabled, 'reminder_2_enabled', new.parcel_reminder_2_enabled,
          'reminder_max', new.parcel_reminder_max, 'email', new.notify_email_enabled, 'sms', new.notify_sms_enabled,
          'arrival', new.parcel_arrival_enabled)));
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
      new.parcel_notifications_enabled, new.parcel_arrival_enabled)
     is distinct from
     (old.quiet_hours_start, old.quiet_hours_end,
      old.parcel_reminder_1_days, old.parcel_reminder_2_days,
      old.parcel_reminder_1_enabled, old.parcel_reminder_2_enabled,
      old.parcel_reminder_max, old.notify_email_enabled, old.notify_sms_enabled,
      old.parcel_notifications_enabled, old.parcel_arrival_enabled) then
    perform public.record_audit(null, 'parcel_flow.changed', 'platform_settings', 'platform', null,
      jsonb_build_object(
        'from', jsonb_build_object('quiet_start', old.quiet_hours_start, 'quiet_end', old.quiet_hours_end,
          'reminder_1_days', old.parcel_reminder_1_days, 'reminder_2_days', old.parcel_reminder_2_days,
          'reminder_1_enabled', old.parcel_reminder_1_enabled, 'reminder_2_enabled', old.parcel_reminder_2_enabled,
          'reminder_max', old.parcel_reminder_max, 'email', old.notify_email_enabled, 'sms', old.notify_sms_enabled,
          'enabled', old.parcel_notifications_enabled, 'arrival', old.parcel_arrival_enabled),
        'to', jsonb_build_object('quiet_start', new.quiet_hours_start, 'quiet_end', new.quiet_hours_end,
          'reminder_1_days', new.parcel_reminder_1_days, 'reminder_2_days', new.parcel_reminder_2_days,
          'reminder_1_enabled', new.parcel_reminder_1_enabled, 'reminder_2_enabled', new.parcel_reminder_2_enabled,
          'reminder_max', new.parcel_reminder_max, 'email', new.notify_email_enabled, 'sms', new.notify_sms_enabled,
          'enabled', new.parcel_notifications_enabled, 'arrival', new.parcel_arrival_enabled)));
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

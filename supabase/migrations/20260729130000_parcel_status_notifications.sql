-- Statusbesked (dagligt sammendrag) på pakkeflowet.
--
-- Hidtil sendte pakkeflowet én besked pr. pakke (ankomst) og pr. påmindelse.
-- Statusbeskeden er en tredje type: på et fast klokkeslæt samles ALT der er
-- ankommet siden sidste statusbesked til samme modtager i ÉN besked. Slået fra
-- som standard (default false) og kl. 13:00 som standard-tidspunkt.
--
-- Enum-værdien 'status' på notification_kind tilføjes i 20260729120000 (kan
-- ikke bruges i samme transaktion som den oprettes).

-- ── Konfiguration: platform-standard + virksomheds-override (null = arv) ─────
alter table public.platform_settings
  add column parcel_status_enabled boolean not null default false,
  add column parcel_status_time time not null default '13:00';

alter table public.companies
  add column parcel_status_enabled boolean,
  add column parcel_status_time time;

-- ── Dedup: højst én statusbesked pr. modtager/kanal pr. lokal dag ────────────
-- Statusbeskeden hører ikke til ÉN pakke (den samler flere), så pakke-/batch-
-- dedup duer ikke. digest_key er den lokale dato (YYYY-MM-DD i Europe/
-- Copenhagen) som dispatcheren kørte sammendraget for — den er dedup-identiteten
-- sammen med modtager og kanal. Null for alle andre notifikationstyper.
alter table public.parcel_notifications
  add column digest_key text;

create unique index parcel_notifications_digest_once_idx
  on public.parcel_notifications (company_id, employee_id, kind, channel, digest_key)
  where digest_key is not null and status = 'sent';

-- Sammendrags-rækker peger stadig på en repræsentativ pakke (parcel_id er not
-- null), men må ikke fange pakke-dedup-indekset: to sammendrag på forskellige
-- dage kan i teorien have samme repræsentant. Pakke-indekset gælder derfor kun
-- rækker uden digest_key.
drop index if exists public.parcel_notifications_once_idx;
create unique index parcel_notifications_once_idx
  on public.parcel_notifications (parcel_id, kind, channel)
  where status = 'sent' and digest_key is null;

-- ── Skabeloner ──────────────────────────────────────────────────────────────
-- Ud over de sædvanlige koder har statusbeskeden {{count}} (antal pakker i
-- sammendraget) og {{parcel_list}} (én linje pr. pakke/batch: stregkode —
-- eller batch-kode med antal i parentes — og modtagelsesdato). SMS-varianten
-- bruger bevidst kun {{count}}: en liste ville sprænge beskeden.
insert into public.platform_templates (key, lang, name, kind, title, body, company_editable) values
  (
    'package_status', 'da', 'Package Status', 'text',
    'Status på dine pakker',
    E'Hej {{recipient_name}},\n\nDer venter {{count}} pakke(r) til dig i varemodtagelsen, modtaget siden sidste statusbesked:\n\n{{parcel_list}}\n\nPakkerne kan afhentes i varemodtagelsen.\n\nMed venlig hilsen\n{{company_name}}',
    true
  ),
  (
    'package_status', 'en', 'Package Status', 'text',
    'Status on your parcels',
    E'Hi {{recipient_name}},\n\n{{count}} parcel(s) are waiting for you at goods reception, received since the last status message:\n\n{{parcel_list}}\n\nThey can be collected at goods reception.\n\nKind regards\n{{company_name}}',
    true
  ),
  (
    'package_status_sms', 'da', 'Package Status (SMS)', 'text', '',
    'Hej {{recipient_name}}. Der venter {{count}} pakke(r) til dig i varemodtagelsen. Mvh {{company_name}}',
    true
  ),
  (
    'package_status_sms', 'en', 'Package Status (SMS)', 'text', '',
    'Hi {{recipient_name}}. {{count}} parcel(s) are waiting for you at goods reception. Regards {{company_name}}',
    true
  )
on conflict (key, lang) do nothing;

-- ── Revisionslog (NIS2): de to nye felter skal med i 'parcel_flow.changed' ───
-- (create or replace — triggerne selv består, jf. 20260718100000/20260724130000.)
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
      new.parcel_arrival_enabled, new.parcel_status_enabled, new.parcel_status_time)
     is distinct from
     (old.quiet_hours_start, old.quiet_hours_end,
      old.parcel_reminder_1_days, old.parcel_reminder_2_days,
      old.parcel_reminder_1_enabled, old.parcel_reminder_2_enabled,
      old.parcel_reminder_max, old.notify_email_enabled, old.notify_sms_enabled,
      old.parcel_arrival_enabled, old.parcel_status_enabled, old.parcel_status_time) then
    perform public.record_audit(new.id, 'parcel_flow.changed', 'company', new.id::text, new.name,
      jsonb_build_object(
        'from', jsonb_build_object('quiet_start', old.quiet_hours_start, 'quiet_end', old.quiet_hours_end,
          'reminder_1_days', old.parcel_reminder_1_days, 'reminder_2_days', old.parcel_reminder_2_days,
          'reminder_1_enabled', old.parcel_reminder_1_enabled, 'reminder_2_enabled', old.parcel_reminder_2_enabled,
          'reminder_max', old.parcel_reminder_max, 'email', old.notify_email_enabled, 'sms', old.notify_sms_enabled,
          'arrival', old.parcel_arrival_enabled,
          'status', old.parcel_status_enabled, 'status_time', old.parcel_status_time),
        'to', jsonb_build_object('quiet_start', new.quiet_hours_start, 'quiet_end', new.quiet_hours_end,
          'reminder_1_days', new.parcel_reminder_1_days, 'reminder_2_days', new.parcel_reminder_2_days,
          'reminder_1_enabled', new.parcel_reminder_1_enabled, 'reminder_2_enabled', new.parcel_reminder_2_enabled,
          'reminder_max', new.parcel_reminder_max, 'email', new.notify_email_enabled, 'sms', new.notify_sms_enabled,
          'arrival', new.parcel_arrival_enabled,
          'status', new.parcel_status_enabled, 'status_time', new.parcel_status_time)));
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
      new.parcel_notifications_enabled, new.parcel_arrival_enabled,
      new.parcel_status_enabled, new.parcel_status_time)
     is distinct from
     (old.quiet_hours_start, old.quiet_hours_end,
      old.parcel_reminder_1_days, old.parcel_reminder_2_days,
      old.parcel_reminder_1_enabled, old.parcel_reminder_2_enabled,
      old.parcel_reminder_max, old.notify_email_enabled, old.notify_sms_enabled,
      old.parcel_notifications_enabled, old.parcel_arrival_enabled,
      old.parcel_status_enabled, old.parcel_status_time) then
    perform public.record_audit(null, 'parcel_flow.changed', 'platform_settings', 'platform', null,
      jsonb_build_object(
        'from', jsonb_build_object('quiet_start', old.quiet_hours_start, 'quiet_end', old.quiet_hours_end,
          'reminder_1_days', old.parcel_reminder_1_days, 'reminder_2_days', old.parcel_reminder_2_days,
          'reminder_1_enabled', old.parcel_reminder_1_enabled, 'reminder_2_enabled', old.parcel_reminder_2_enabled,
          'reminder_max', old.parcel_reminder_max, 'email', old.notify_email_enabled, 'sms', old.notify_sms_enabled,
          'enabled', old.parcel_notifications_enabled, 'arrival', old.parcel_arrival_enabled,
          'status', old.parcel_status_enabled, 'status_time', old.parcel_status_time),
        'to', jsonb_build_object('quiet_start', new.quiet_hours_start, 'quiet_end', new.quiet_hours_end,
          'reminder_1_days', new.parcel_reminder_1_days, 'reminder_2_days', new.parcel_reminder_2_days,
          'reminder_1_enabled', new.parcel_reminder_1_enabled, 'reminder_2_enabled', new.parcel_reminder_2_enabled,
          'reminder_max', new.parcel_reminder_max, 'email', new.notify_email_enabled, 'sms', new.notify_sms_enabled,
          'enabled', new.parcel_notifications_enabled, 'arrival', new.parcel_arrival_enabled,
          'status', new.parcel_status_enabled, 'status_time', new.parcel_status_time)));
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

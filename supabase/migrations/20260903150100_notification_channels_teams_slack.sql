-- Teams/Slack som notifikationskanaler: indstillinger, tilvalg og skabeloner.
--
-- Selve afsendelsen er endnu ikke bygget (se _shared/send-teams.ts og
-- send-slack.ts). Rørene lægges først, så dispatcheren bliver kanal-generisk
-- ét sted i stedet for at få endnu et 'if channel === ...'-lag pr. udvidelse.
--
-- Intet sker utilsigtet: begge platform-standarder er false, og begge kanaler
-- kræver desuden et tilvalg pr. kunde (som sms_notifications). En kunde skal
-- altså både have tilvalget OG slå kanalen til, før dispatcheren rører den.

-- ── Kanalvalg: platform-standard + virksomheds-override (null = arv) ─────────
alter table public.platform_settings
  add column notify_teams_enabled boolean not null default false,
  add column notify_slack_enabled boolean not null default false;

alter table public.companies
  add column notify_teams_enabled boolean,
  add column notify_slack_enabled boolean;

-- ── Tilvalg pr. kunde ───────────────────────────────────────────────────────
-- Begge kanaler kræver en installation i kundens eget miljø (Teams: vores app
-- godkendt og installeret i deres Entra-tenant; Slack: vores app installeret i
-- deres workspace). Tilvalget er derfor både en kommerciel og en teknisk
-- forudsætning — uden det giver kanalen ingen mening.
insert into public.feature_catalog (key, product_key, name, description, name_en, description_en)
values
  (
    'teams_notifications', 'parcels',
    'Teams-notifikationer', 'Send pakkenotifikationer som Teams-besked til modtageren',
    'Teams notifications', 'Send parcel notifications as a Teams message to the recipient'
  ),
  (
    'slack_notifications', 'parcels',
    'Slack-notifikationer', 'Send pakkenotifikationer som Slack-besked til modtageren',
    'Slack notifications', 'Send parcel notifications as a Slack message to the recipient'
  )
on conflict (key) do nothing;

-- ── Skabeloner ──────────────────────────────────────────────────────────────
-- Chat-varianter af de eksisterende pakkeskabeloner. Som SMS har de ingen emne
-- (title = ''), for en chatbesked har ingen emnelinje — men i modsætning til
-- SMS koster linjeskift ingenting, så de må gerne fylde et par linjer.
-- Samme sprogneutrale {{snake_case}}-tokens som e-mail/SMS.
--
-- Nøglemønsteret er BEVIDST '<base>_<kanal>' (som '_sms'), fordi dispatcheren
-- udleder nøglen af basen + kanalens suffiks. En ny kanal må ikke bryde det.
insert into public.platform_templates (key, lang, name, kind, title, body, company_editable) values
  -- Ankomst, enkelt pakke
  (
    'package_arrival_teams', 'da', 'Package Arrival (Teams)', 'text', '',
    E'Hej {{recipient_name}} — din pakke {{barcode}} er ankommet d. {{date}}.\nDen kan afhentes i varemodtagelsen.\n\n{{company_name}}',
    true
  ),
  (
    'package_arrival_teams', 'en', 'Package Arrival (Teams)', 'text', '',
    E'Hi {{recipient_name}} — your parcel {{barcode}} arrived on {{date}}.\nIt can be collected at goods reception.\n\n{{company_name}}',
    true
  ),
  (
    'package_arrival_slack', 'da', 'Package Arrival (Slack)', 'text', '',
    E'Hej {{recipient_name}} — din pakke {{barcode}} er ankommet d. {{date}}.\nDen kan afhentes i varemodtagelsen.\n\n{{company_name}}',
    true
  ),
  (
    'package_arrival_slack', 'en', 'Package Arrival (Slack)', 'text', '',
    E'Hi {{recipient_name}} — your parcel {{barcode}} arrived on {{date}}.\nIt can be collected at goods reception.\n\n{{company_name}}',
    true
  ),

  -- Påmindelse 1, enkelt pakke
  (
    'package_reminder_1_teams', 'da', 'Package Reminder 1 (Teams)', 'text', '',
    E'Hej {{recipient_name}} — påmindelse: din pakke {{barcode}}, modtaget d. {{date}}, venter stadig i varemodtagelsen.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_1_teams', 'en', 'Package Reminder 1 (Teams)', 'text', '',
    E'Hi {{recipient_name}} — reminder: your parcel {{barcode}}, received on {{date}}, is still waiting at goods reception.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_1_slack', 'da', 'Package Reminder 1 (Slack)', 'text', '',
    E'Hej {{recipient_name}} — påmindelse: din pakke {{barcode}}, modtaget d. {{date}}, venter stadig i varemodtagelsen.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_1_slack', 'en', 'Package Reminder 1 (Slack)', 'text', '',
    E'Hi {{recipient_name}} — reminder: your parcel {{barcode}}, received on {{date}}, is still waiting at goods reception.\n\n{{company_name}}',
    true
  ),

  -- Påmindelse 2, enkelt pakke
  (
    'package_reminder_2_teams', 'da', 'Package Reminder 2 (Teams)', 'text', '',
    E'Hej {{recipient_name}} — sidste påmindelse: din pakke {{barcode}}, modtaget d. {{date}}, venter i varemodtagelsen. Afhent den snarest.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_2_teams', 'en', 'Package Reminder 2 (Teams)', 'text', '',
    E'Hi {{recipient_name}} — final reminder: your parcel {{barcode}}, received on {{date}}, is waiting at goods reception. Please collect it soon.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_2_slack', 'da', 'Package Reminder 2 (Slack)', 'text', '',
    E'Hej {{recipient_name}} — sidste påmindelse: din pakke {{barcode}}, modtaget d. {{date}}, venter i varemodtagelsen. Afhent den snarest.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_2_slack', 'en', 'Package Reminder 2 (Slack)', 'text', '',
    E'Hi {{recipient_name}} — final reminder: your parcel {{barcode}}, received on {{date}}, is waiting at goods reception. Please collect it soon.\n\n{{company_name}}',
    true
  ),

  -- Ankomst, batch ({{count}} + {{batch_code}}, aldrig {{barcode}})
  (
    'package_arrival_batch_teams', 'da', 'Package Arrival batch (Teams)', 'text', '',
    E'Hej {{recipient_name}} — {{count}} pakker (batch {{batch_code}}) er ankommet d. {{date}}.\nDe kan afhentes samlet i varemodtagelsen.\n\n{{company_name}}',
    true
  ),
  (
    'package_arrival_batch_teams', 'en', 'Package Arrival batch (Teams)', 'text', '',
    E'Hi {{recipient_name}} — {{count}} parcels (batch {{batch_code}}) arrived on {{date}}.\nThey can be collected together at goods reception.\n\n{{company_name}}',
    true
  ),
  (
    'package_arrival_batch_slack', 'da', 'Package Arrival batch (Slack)', 'text', '',
    E'Hej {{recipient_name}} — {{count}} pakker (batch {{batch_code}}) er ankommet d. {{date}}.\nDe kan afhentes samlet i varemodtagelsen.\n\n{{company_name}}',
    true
  ),
  (
    'package_arrival_batch_slack', 'en', 'Package Arrival batch (Slack)', 'text', '',
    E'Hi {{recipient_name}} — {{count}} parcels (batch {{batch_code}}) arrived on {{date}}.\nThey can be collected together at goods reception.\n\n{{company_name}}',
    true
  ),

  -- Påmindelse 1, batch
  (
    'package_reminder_1_batch_teams', 'da', 'Package Reminder 1 batch (Teams)', 'text', '',
    E'Hej {{recipient_name}} — påmindelse: dine {{count}} pakker (batch {{batch_code}}), modtaget d. {{date}}, venter stadig i varemodtagelsen.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_1_batch_teams', 'en', 'Package Reminder 1 batch (Teams)', 'text', '',
    E'Hi {{recipient_name}} — reminder: your {{count}} parcels (batch {{batch_code}}), received on {{date}}, are still waiting at goods reception.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_1_batch_slack', 'da', 'Package Reminder 1 batch (Slack)', 'text', '',
    E'Hej {{recipient_name}} — påmindelse: dine {{count}} pakker (batch {{batch_code}}), modtaget d. {{date}}, venter stadig i varemodtagelsen.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_1_batch_slack', 'en', 'Package Reminder 1 batch (Slack)', 'text', '',
    E'Hi {{recipient_name}} — reminder: your {{count}} parcels (batch {{batch_code}}), received on {{date}}, are still waiting at goods reception.\n\n{{company_name}}',
    true
  ),

  -- Påmindelse 2, batch
  (
    'package_reminder_2_batch_teams', 'da', 'Package Reminder 2 batch (Teams)', 'text', '',
    E'Hej {{recipient_name}} — sidste påmindelse: dine {{count}} pakker (batch {{batch_code}}), modtaget d. {{date}}, venter i varemodtagelsen. Kontakt varemodtagelsen, hvis du ikke selv kan afhente dem.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_2_batch_teams', 'en', 'Package Reminder 2 batch (Teams)', 'text', '',
    E'Hi {{recipient_name}} — final reminder: your {{count}} parcels (batch {{batch_code}}), received on {{date}}, are waiting at goods reception. Contact goods reception if you cannot collect them yourself.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_2_batch_slack', 'da', 'Package Reminder 2 batch (Slack)', 'text', '',
    E'Hej {{recipient_name}} — sidste påmindelse: dine {{count}} pakker (batch {{batch_code}}), modtaget d. {{date}}, venter i varemodtagelsen. Kontakt varemodtagelsen, hvis du ikke selv kan afhente dem.\n\n{{company_name}}',
    true
  ),
  (
    'package_reminder_2_batch_slack', 'en', 'Package Reminder 2 batch (Slack)', 'text', '',
    E'Hi {{recipient_name}} — final reminder: your {{count}} parcels (batch {{batch_code}}), received on {{date}}, are waiting at goods reception. Contact goods reception if you cannot collect them yourself.\n\n{{company_name}}',
    true
  ),

  -- Dagligt statussammendrag. Chat kan bære {{parcel_list}} (modsat SMS).
  (
    'package_status_teams', 'da', 'Package Status (Teams)', 'text', '',
    E'Hej {{recipient_name}} — der venter {{count}} pakke(r) til dig i varemodtagelsen:\n\n{{parcel_list}}\n\n{{company_name}}',
    true
  ),
  (
    'package_status_teams', 'en', 'Package Status (Teams)', 'text', '',
    E'Hi {{recipient_name}} — {{count}} parcel(s) are waiting for you at goods reception:\n\n{{parcel_list}}\n\n{{company_name}}',
    true
  ),
  (
    'package_status_slack', 'da', 'Package Status (Slack)', 'text', '',
    E'Hej {{recipient_name}} — der venter {{count}} pakke(r) til dig i varemodtagelsen:\n\n{{parcel_list}}\n\n{{company_name}}',
    true
  ),
  (
    'package_status_slack', 'en', 'Package Status (Slack)', 'text', '',
    E'Hi {{recipient_name}} — {{count}} parcel(s) are waiting for you at goods reception:\n\n{{parcel_list}}\n\n{{company_name}}',
    true
  )
on conflict (key, lang) do nothing;

comment on column public.companies.notify_teams_enabled is
  'Send pakkenotifikationer som Teams-besked. null = arv platform_settings.';
comment on column public.companies.notify_slack_enabled is
  'Send pakkenotifikationer som Slack-besked. null = arv platform_settings.';

-- ── Revisionslog: kanalvalget skal kunne aflæses i audit_log ────────────────
-- audit_company_billing_settings / audit_platform_billing_settings sammenligner
-- eksplicitte kolonnelister. Uden denne genskrivning ville et skift af Teams-
-- eller Slack-kanalen ikke give en 'parcel_flow.changed'-række — en kunde kunne
-- altså begynde at sende personoplysninger til en ny kanal, uden spor i loggen.
-- Funktionerne er kopieret fra 20260729130000 med de to nye kolonner tilføjet;
-- triggerne selv består (create or replace).

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
      new.notify_teams_enabled, new.notify_slack_enabled,
      new.parcel_arrival_enabled, new.parcel_status_enabled, new.parcel_status_time)
     is distinct from
     (old.quiet_hours_start, old.quiet_hours_end,
      old.parcel_reminder_1_days, old.parcel_reminder_2_days,
      old.parcel_reminder_1_enabled, old.parcel_reminder_2_enabled,
      old.parcel_reminder_max, old.notify_email_enabled, old.notify_sms_enabled,
      old.notify_teams_enabled, old.notify_slack_enabled,
      old.parcel_arrival_enabled, old.parcel_status_enabled, old.parcel_status_time) then
    perform public.record_audit(new.id, 'parcel_flow.changed', 'company', new.id::text, new.name,
      jsonb_build_object(
        'from', jsonb_build_object('quiet_start', old.quiet_hours_start, 'quiet_end', old.quiet_hours_end,
          'reminder_1_days', old.parcel_reminder_1_days, 'reminder_2_days', old.parcel_reminder_2_days,
          'reminder_1_enabled', old.parcel_reminder_1_enabled, 'reminder_2_enabled', old.parcel_reminder_2_enabled,
          'reminder_max', old.parcel_reminder_max, 'email', old.notify_email_enabled, 'sms', old.notify_sms_enabled,
          'teams', old.notify_teams_enabled, 'slack', old.notify_slack_enabled,
          'arrival', old.parcel_arrival_enabled,
          'status', old.parcel_status_enabled, 'status_time', old.parcel_status_time),
        'to', jsonb_build_object('quiet_start', new.quiet_hours_start, 'quiet_end', new.quiet_hours_end,
          'reminder_1_days', new.parcel_reminder_1_days, 'reminder_2_days', new.parcel_reminder_2_days,
          'reminder_1_enabled', new.parcel_reminder_1_enabled, 'reminder_2_enabled', new.parcel_reminder_2_enabled,
          'reminder_max', new.parcel_reminder_max, 'email', new.notify_email_enabled, 'sms', new.notify_sms_enabled,
          'teams', new.notify_teams_enabled, 'slack', new.notify_slack_enabled,
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
      new.notify_teams_enabled, new.notify_slack_enabled,
      new.parcel_notifications_enabled, new.parcel_arrival_enabled,
      new.parcel_status_enabled, new.parcel_status_time)
     is distinct from
     (old.quiet_hours_start, old.quiet_hours_end,
      old.parcel_reminder_1_days, old.parcel_reminder_2_days,
      old.parcel_reminder_1_enabled, old.parcel_reminder_2_enabled,
      old.parcel_reminder_max, old.notify_email_enabled, old.notify_sms_enabled,
      old.notify_teams_enabled, old.notify_slack_enabled,
      old.parcel_notifications_enabled, old.parcel_arrival_enabled,
      old.parcel_status_enabled, old.parcel_status_time) then
    perform public.record_audit(null, 'parcel_flow.changed', 'platform_settings', 'platform', null,
      jsonb_build_object(
        'from', jsonb_build_object('quiet_start', old.quiet_hours_start, 'quiet_end', old.quiet_hours_end,
          'reminder_1_days', old.parcel_reminder_1_days, 'reminder_2_days', old.parcel_reminder_2_days,
          'reminder_1_enabled', old.parcel_reminder_1_enabled, 'reminder_2_enabled', old.parcel_reminder_2_enabled,
          'reminder_max', old.parcel_reminder_max, 'email', old.notify_email_enabled, 'sms', old.notify_sms_enabled,
          'teams', old.notify_teams_enabled, 'slack', old.notify_slack_enabled,
          'enabled', old.parcel_notifications_enabled, 'arrival', old.parcel_arrival_enabled,
          'status', old.parcel_status_enabled, 'status_time', old.parcel_status_time),
        'to', jsonb_build_object('quiet_start', new.quiet_hours_start, 'quiet_end', new.quiet_hours_end,
          'reminder_1_days', new.parcel_reminder_1_days, 'reminder_2_days', new.parcel_reminder_2_days,
          'reminder_1_enabled', new.parcel_reminder_1_enabled, 'reminder_2_enabled', new.parcel_reminder_2_enabled,
          'reminder_max', new.parcel_reminder_max, 'email', new.notify_email_enabled, 'sms', new.notify_sms_enabled,
          'teams', new.notify_teams_enabled, 'slack', new.notify_slack_enabled,
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

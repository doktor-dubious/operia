-- Kundeudtrækket (F-08) skal kende de nye tabeller: integrationernes opsætning,
-- kørsler og fejlliste er kundens data; Dalux-nøglen er en hemmelighed.
-- Fixturen company_full_export.sql håndhæver, at ingen company_id-tabel står
-- uden for begge lister.

CREATE OR REPLACE FUNCTION public.company_export_catalog()
 RETURNS TABLE(grp text, tbl text, ord integer)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select * from (values
    -- Kerne: det der findes uanset hvilke produkter kunden har købt.
    ('core', 'companies',                   10),
    ('core', 'app_users',                   20),
    ('core', 'employees',                   30),
    ('core', 'departments',                 40),
    ('core', 'company_products',            50),
    ('core', 'company_features',            60),
    ('core', 'company_retention',           70),
    ('core', 'company_templates',           80),
    ('core', 'app_text_override',           90),
    ('core', 'company_home_config',        100),
    ('core', 'company_handheld_config',    110),
    ('core', 'product_appearance',         120),
    ('core', 'company_ai_config',          130),
    ('core', 'company_accounting_config',  140),
    ('core', 'company_data_transfer',      150),
    ('core', 'company_entra_config',       160),
    ('core', 'company_slack_config',       170),
    ('core', 'log_drains',                 180),
    ('core', 'account_emails',             190),
    ('core', 'import_configs',             200),
    ('core', 'import_runs',                210),
    ('core', 'inbound_files',              220),
    ('core', 'feedback',                   230),
    ('core', 'audit_log',                  240),

    ('parcels', 'parcels',                 10),
    ('parcels', 'parcel_events',           20),
    ('parcels', 'parcel_batches',          30),
    ('parcels', 'parcel_documents',        40),
    ('parcels', 'parcel_notifications',    50),
    ('parcels', 'storage_locations',       60),
    ('parcels', 'handling_classes',        70),
    ('parcels', 'carriers',                80),

    ('assets', 'assets',                   10),
    ('assets', 'asset_categories',         20),
    ('assets', 'asset_locations',          30),
    ('assets', 'asset_events',             40),
    ('assets', 'asset_loans',              50),
    ('assets', 'asset_loan_notifications', 60),
    ('assets', 'asset_documents',          70),

    ('lager',    'inventory_items',        10),
    ('lockers',  'lockers',                10),
    ('shipping', 'carrier_agreements',     10),
    ('routes',   'routes',                 10),

    ('booking', 'bookings',                    10),
    ('booking', 'booking_events',              20),
    ('booking', 'booking_resources',           30),
    ('booking', 'booking_categories',          40),
    ('booking', 'booking_services',            50),
    ('booking', 'booking_service_lines',       60),
    ('booking', 'booking_participant_levels',  70),
    ('booking', 'booking_notifications',       80),
    -- Integrationernes egne data (2026-09-13): opsætning, kørsler og fejlliste
    -- hører til kunden; nøglerne gør ikke (undtaget).
    ('core', 'company_dalux_config',            250),
    ('core', 'dalux_sync_runs',                 260),
    ('core', 'dalux_sync_items',                270),
    ('core', 'company_booking_export_schedule', 280),
    ('core', 'booking_export_files',            290),
    ('booking', 'booking_tariffs',             90),
    ('booking', 'invoice_drafts',             100),
    ('booking', 'invoice_draft_lines',        110)
  ) as v(grp, tbl, ord)
$function$;

CREATE OR REPLACE FUNCTION public.company_export_excluded()
 RETURNS TABLE(tbl text, reason text)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select * from (values
    -- Adgangsnøgler til kundens andre systemer — ikke kundens data.
    ('company_accounting_secret',    'secret'),
    ('company_data_transfer_secret', 'secret'),
    ('company_entra_secret',         'secret'),
    ('company_slack_secret',         'secret'),
    ('company_dalux_secret',         'secret'),
    ('slack_oauth_state',            'secret'),
    -- Interne tællere og låse uden informationsindhold.
    ('asset_no_seq',       'counter'),
    ('parcel_barcode_seq', 'counter'),
    ('import_locks',       'counter'),
    ('invoice_draft_seq',  'counter')
  ) as v(tbl, reason)
$function$;

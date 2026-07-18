-- Aktiv-udlåns-notifikationer: påmindelser om udløbne udlån (Aktiver-modulet).
-- Samme form som pakkeflowet, men forankret på udlånets UDLØB i stedet for
-- registrering: 1. besked på udløbsdagen, derefter påmindelse 1 / 2 et antal
-- dage EFTER udløb. Genbruger kanalvalg (notify_email/sms) og enum'erne fra
-- pakke-notifikationsmigrationen (20260718090000). For aktiver betyder
-- notification_kind='arrival' "udløbs-beskeden" (den forankrede 1. besked).

-- ── Konfiguration: platform-standard + virksomheds-override (null = arv) ──────
alter table public.platform_settings
  add column asset_notifications_enabled boolean not null default false,
  add column asset_reminder_1_days integer not null default 3 check (asset_reminder_1_days >= 1),
  add column asset_reminder_2_days integer not null default 7,
  add column asset_reminder_1_enabled boolean not null default true,
  add column asset_reminder_2_enabled boolean not null default true,
  add column asset_reminder_max integer not null default 0 check (asset_reminder_max >= 0);

alter table public.platform_settings
  add constraint platform_settings_asset_reminder_order
    check (asset_reminder_2_days > asset_reminder_1_days),
  add constraint platform_settings_asset_reminder_enable_order
    check (asset_reminder_1_enabled or not asset_reminder_2_enabled);

alter table public.companies
  add column asset_reminder_1_days integer
    check (asset_reminder_1_days is null or asset_reminder_1_days >= 1),
  add column asset_reminder_2_days integer,
  add column asset_reminder_1_enabled boolean,
  add column asset_reminder_2_enabled boolean,
  add column asset_reminder_max integer
    check (asset_reminder_max is null or asset_reminder_max >= 0);

alter table public.companies
  add constraint companies_asset_reminder_order
    check (
      asset_reminder_2_days is null
      or asset_reminder_1_days is null
      or asset_reminder_2_days > asset_reminder_1_days
    ),
  add constraint companies_asset_reminder_enable_order
    check (
      asset_reminder_1_enabled is null
      or asset_reminder_2_enabled is null
      or asset_reminder_1_enabled
      or not asset_reminder_2_enabled
    );

-- ── Afsendelses-/leveringslog (samme mønster som parcel_notifications) ────────
create table public.asset_loan_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  loan_id uuid not null references public.asset_loans (id) on delete cascade,
  asset_id uuid references public.assets (id) on delete set null,
  kind public.notification_kind not null,   -- 'arrival' = udløbs-besked
  channel public.notification_channel not null,
  lang text not null default 'da',
  recipient text,          -- den faktisk brugte adresse (e-mail eller msisdn)
  status public.notification_status not null,
  provider_id text,        -- resend-id / gatewayapi msg_id
  error text,
  created_at timestamptz not null default now()
);

create index asset_loan_notifications_loan_idx on public.asset_loan_notifications (loan_id);
create index asset_loan_notifications_company_idx on public.asset_loan_notifications (company_id, created_at desc);

-- Dedup + crash-sikkerhed: højst én gennemført afsendelse pr. udlån/type/kanal.
create unique index asset_loan_notifications_once_idx
  on public.asset_loan_notifications (loan_id, kind, channel)
  where status = 'sent';

alter table public.asset_loan_notifications enable row level security;

create policy asset_loan_notifications_select on public.asset_loan_notifications
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

grant select on public.asset_loan_notifications to authenticated;
grant select, insert on public.asset_loan_notifications to service_role;

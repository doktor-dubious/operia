-- Pakke-notifikationer: afsendelses-/leveringslog + kanalvalg + hovedafbryder.
-- Dette er "send"-siden af pakkeflowets notifikationer (ankomst + påmindelser);
-- konfigurationen (påmindelsesdage/toggles/max/stilletid) og skabelonerne
-- fandtes i forvejen — her kommer det, der faktisk sender og logger.
--
-- Dispatcheren (edge function dispatch-parcel-notifications, kaldt af pg_cron)
-- skriver én række pr. afsendt notifikation i parcel_notifications. Loggen er
-- NIS2-revisionssporet OG mekanismen der forhindrer dobbeltafsendelse (unikt
-- 'sent'-indeks) og tæller mod parcel_reminder_max.

-- ── Kanalvalg: e-mail og/eller SMS. Platform-standard + virksomheds-override ──
-- (null i companies = arv platformens, som resten af pakkeflow-felterne). SMS er
-- slået fra som standard — det koster penge og kræver sms_notifications-feature.
alter table public.platform_settings
  add column notify_email_enabled boolean not null default true,
  add column notify_sms_enabled boolean not null default false,
  -- Hovedafbryder: dispatcheren og dens cron-job rører intet, før den er sat til
  -- true. Beskytter mod at et helt bagkatalog af åbne pakker får notifikation i
  -- samme øjeblik feature'en aktiveres.
  add column parcel_notifications_enabled boolean not null default false;

alter table public.companies
  add column notify_email_enabled boolean,
  add column notify_sms_enabled boolean;

-- ── SMS som betalt tilvalg (feature gated pr. virksomhed) ────────────────────
insert into public.feature_catalog (key, product_key, name, description, name_en, description_en)
values (
  'sms_notifications', 'parcels',
  'SMS-notifikationer', 'Send pakkenotifikationer som SMS (GatewayAPI)',
  'SMS notifications', 'Send parcel notifications as SMS (GatewayAPI)'
)
on conflict (key) do nothing;

-- ── Afsendelses-/leveringslog ────────────────────────────────────────────────
create type public.notification_kind as enum ('arrival', 'reminder_1', 'reminder_2');
create type public.notification_channel as enum ('email', 'sms');
create type public.notification_status as enum ('sent', 'failed', 'skipped');

create table public.parcel_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  parcel_id uuid not null references public.parcels (id) on delete cascade,
  employee_id uuid references public.employees (id) on delete set null,
  kind public.notification_kind not null,
  channel public.notification_channel not null,
  lang text not null default 'da',
  recipient text,          -- den faktisk brugte adresse (e-mail eller msisdn)
  status public.notification_status not null,
  provider_id text,        -- resend-id / gatewayapi msg_id
  error text,
  created_at timestamptz not null default now()
);

create index parcel_notifications_parcel_idx on public.parcel_notifications (parcel_id);
create index parcel_notifications_company_idx on public.parcel_notifications (company_id, created_at desc);

-- Dedup + crash-sikkerhed: højst én GENNEMFØRT afsendelse pr. pakke/type/kanal.
-- En samtidig gentagelse fejler på indekset i stedet for at sende igen.
create unique index parcel_notifications_once_idx
  on public.parcel_notifications (parcel_id, kind, channel)
  where status = 'sent';

-- Append-only revisionsspor (NIS2): kun service-role (dispatcheren) skriver;
-- egen virksomheds managers + platform-admins kan læse.
alter table public.parcel_notifications enable row level security;

create policy parcel_notifications_select on public.parcel_notifications
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

grant select on public.parcel_notifications to authenticated;
grant select, insert on public.parcel_notifications to service_role;

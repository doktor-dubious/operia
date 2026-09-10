-- Booking-notifikationer (EVU-krav A-04): bekræftelse ved oprettelse og
-- ændring, plus annullering, påmindelse og besked når grundlaget er sendt til
-- fakturering.
--
-- Bygger på notifikationslaget der allerede findes for pakker og aktiver:
-- kanalregistret (_shared/channels.ts), skabelonerne (platform_templates +
-- company_templates), stilletiden, kanal-tilvalgene og beskedloggen. Intet af
-- det genopfindes her — booking får sine egne indstillinger, sin egen beskedlog
-- og sine egne skabeloner i de samme former.
--
-- MODTAGERNE — og hvorfor de ser sådan ud
--
-- Kravet siger "til rekvirent og relevante modtagere". En booking i Operia har
-- i dag ÉN person: `employee_id`, den bookingen er til. Der findes hverken en
-- rekvirent som selvstændigt begreb eller en deltagerliste (det følger med
-- debitor-arbejdet, jf. docs/evu-booking-kravstatus.md E-01). Indtil da:
--   employee — medarbejderen bookingen er til. Altid.
--   booker   — `bookings.booked_by`, altså den der oprettede bookingen. Det ER
--              rekvirenten i det mønster kravet beskriver: en koordinator, der
--              booker et lokale til en anden. Slås op via employees.user_id, så
--              vedkommende kan nås på alle kanaler; ellers app_users.email.
--              Springes over når det er samme person som medarbejderen.
--   copy     — én fast adresse pr. kunde (reception, servicedesk, kantine).
--              Det er "relevante modtagere" i praksis. Kun e-mail.
--   economy  — én fast adresse pr. kunde til faktureringsbeskeden. Der findes
--              ENDNU ingen økonomirolle (krav F-01), og hele platformen
--              adresserer medarbejdere, ikke app-brugere — så en postkasse er
--              det ærlige valg nu. Får kunden en økonomirolle, er det denne
--              audience der skifter opslag. Kun e-mail.
--
-- PÅMINDELSEN MÅLES I TIMER, ikke dage som pakke-/aktiv-påmindelserne. Et
-- mødelokale bookes typisk samme uge og en puljebil samme dag; "3 dage før"
-- ville aldrig nå at udløse for flertallet af bookinger. 24 timer er standard,
-- og 48/72 dækker "dage før" fint.
--
-- Bevidst udeladt: gentagne påmindelser (én er nok før et møde), notifikation
-- ved oprettelse af bookinger i fortiden (efterregistrering — der er intet at
-- varsle om), og deltagerlister.

-- ---------------------------------------------------------------------------
-- 1. Indstillinger: platformens standard + kundens override (null = arv)
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  add column booking_notifications_enabled boolean not null default false,
  add column booking_created_enabled boolean not null default true,
  add column booking_updated_enabled boolean not null default true,
  add column booking_cancelled_enabled boolean not null default true,
  add column booking_reminder_enabled boolean not null default false,
  add column booking_reminder_hours integer not null default 24,
  add column booking_invoiced_enabled boolean not null default false,
  add column booking_notify_booker boolean not null default true;

alter table public.platform_settings
  add constraint platform_settings_booking_reminder_hours_check
    check (booking_reminder_hours between 1 and 336);

comment on column public.platform_settings.booking_notifications_enabled is
  'Hovedafbryder for booking-notifikationer (som parcel_/asset_notifications_enabled). Slået fra indtil skabeloner og modtageradresser er på plads hos den første kunde.';

alter table public.companies
  add column booking_created_enabled boolean,
  add column booking_updated_enabled boolean,
  add column booking_cancelled_enabled boolean,
  add column booking_reminder_enabled boolean,
  add column booking_reminder_hours integer,
  add column booking_invoiced_enabled boolean,
  add column booking_notify_booker boolean,
  -- Adresserne har ingen platformstandard: en postkasse er kundens egen.
  add column booking_copy_email text,
  add column booking_invoice_email text;

alter table public.companies
  add constraint companies_booking_reminder_hours_check
    check (booking_reminder_hours is null or booking_reminder_hours between 1 and 336);

-- Adressefelterne er fri tekst fra en manager og ender som modtager i en
-- afsendelse — så de valideres her, ikke kun i browseren. Formen er bevidst
-- løs (ét @, ingen mellemrum/kontroltegn, rimelig længde): en streng
-- RFC-validering afviser gyldige adresser, og udbyderen validerer selv.
alter table public.companies
  add constraint companies_booking_copy_email_sane
    check (booking_copy_email is null or
           (booking_copy_email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'
            and char_length(booking_copy_email) <= 320)),
  add constraint companies_booking_invoice_email_sane
    check (booking_invoice_email is null or
           (booking_invoice_email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$'
            and char_length(booking_invoice_email) <= 320));

comment on column public.companies.booking_copy_email is
  'Fast kopimodtager for alle booking-beskeder (reception/servicedesk). NULL = ingen kopi. Kun e-mail.';
comment on column public.companies.booking_invoice_email is
  'Postkasse der får besked når en booking er sendt til fakturering. NULL = ingen besked. Kun e-mail. Erstattes af en økonomirolle når krav F-01 bygges.';

-- ---------------------------------------------------------------------------
-- 2. Beskedloggen
--
-- Samme form som parcel_notifications/asset_loan_notifications: én række pr.
-- (besked, modtagerrolle, kanal) med udfald, så en fejl kan aflæses og et
-- forsøg aldrig gentages i det uendelige.
--
-- Dedup-nøglen er `event_id` — id'et på hændelsen i booking_events. Det er
-- rigtigere end (booking, art): en booking kan ændres ti gange, og hver ændring
-- er sin egen bekræftelse, mens ÉN ændring aldrig må sendes to gange, uanset
-- hvor mange gange cron kører. Påmindelser har ingen hændelse og dedupes på
-- (booking, art, modtager, kanal).
--
-- Kolonnen har med vilje INGEN foreign key til booking_events: den log er
-- append-only og må aldrig kunne blokeres eller kaskaderes af en anden tabel
-- (samme begrundelse som booking_events.actor_user_id).
-- ---------------------------------------------------------------------------
create type public.booking_notification_kind as enum
  ('created', 'updated', 'cancelled', 'reminder', 'invoiced');

create type public.booking_notification_audience as enum
  ('employee', 'booker', 'copy', 'economy');

create table public.booking_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  event_id bigint,
  kind public.booking_notification_kind not null,
  audience public.booking_notification_audience not null,
  channel public.notification_channel not null,
  lang text not null default 'da',
  -- Modtageradressen: samme behandling som de øvrige beskedlogge — den står
  -- her til fejlsøgning, men maskeres altid før den når audit_log.
  recipient text,
  status public.notification_status not null,
  provider_id text,
  error text,
  created_at timestamptz not null default now()
);

create index booking_notifications_company_idx
  on public.booking_notifications (company_id, created_at desc);
create index booking_notifications_booking_idx
  on public.booking_notifications (booking_id);

-- Én hændelse må give én besked pr. modtagerrolle pr. kanal.
create unique index booking_notifications_event_once_idx
  on public.booking_notifications (event_id, audience, channel)
  where status = 'sent' and event_id is not null;

-- Påmindelsen har ingen hændelse — den dedupes på selve bookingen.
create unique index booking_notifications_reminder_once_idx
  on public.booking_notifications (booking_id, audience, channel)
  where status = 'sent' and kind = 'reminder';

alter table public.booking_notifications enable row level security;

create policy booking_notifications_select on public.booking_notifications
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

grant select on public.booking_notifications to authenticated;

-- Skrivning sker kun med service-role fra dispatcheren (ingen skrivepolitik),
-- som de øvrige beskedlogge.

-- ---------------------------------------------------------------------------
-- 3. Opbevaring: beskedloggen følger kategorien 'notifications'
--
-- Rækker for en booking der endnu ikke er afholdt bevares uanset vinduet: de ER
-- dispatcherens dedup-tilstand, og slettes de, sendes påmindelsen forfra.
-- Samme forbehold som pakke-/udlånsgrenene i run_retention_purge.
--
-- Purgen ligger i sin EGEN funktion og hænges på retention-cronjobbet ved
-- siden af run_retention_purge — ikke inde i den. run_retention_purge
-- genskrives i sin helhed af nye migrationer (senest 20260903140000), og en
-- blok tilføjet inde i den ville forsvinde tavst næste gang nogen genskaber
-- den. Det ville vise sig som en beskedlog der voksede for evigt, uden fejl.
-- ---------------------------------------------------------------------------
create or replace function public.purge_booking_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  d integer;
  n bigint;
begin
  for c in select id from public.companies loop
    d := public.retention_days(c.id, 'notifications');
    if d is null then
      continue;
    end if;

    delete from public.booking_notifications n2
      where n2.company_id = c.id
        and n2.created_at < now() - make_interval(days => d)
        and not exists (
          select 1 from public.bookings b
          where b.id = n2.booking_id and b.ends_at > now());
    get diagnostics n = row_count;

    if n > 0 then
      perform public.record_audit(c.id, 'retention.purged', 'booking_notification', c.id::text, null,
        jsonb_build_object('table', 'booking_notifications', 'deleted', n, 'retention_days', d));
    end if;
  end loop;
end;
$$;

revoke execute on function public.purge_booking_notifications() from public, anon, authenticated;

comment on function public.purge_booking_notifications() is
  'Opbevaringspurge for booking_notifications (kategorien notifications). Egen funktion, fordi run_retention_purge genskrives i sin helhed af nye migrationer.';

-- Kør den sammen med den øvrige purge. cron.schedule på et EKSISTERENDE
-- jobnavn erstatter kommandoen, så jobbet beholder sin plads og sit tidspunkt.
select cron.schedule('operia-retention-purge', '40 3 * * *', $job$
  select public.run_retention_purge();
  select public.purge_booking_notifications();
$job$);

-- ---------------------------------------------------------------------------
-- 4. Skabeloner: 5 beskeder × 4 kanaler × 2 sprog.
--
-- Nøglerne følger kanalregistrets suffikser (templateKeyFor): e-mail er basen,
-- de øvrige får _sms/_teams/_slack. Rækkerne dukker op af sig selv på
-- Operia → Skabeloner og (company_editable) Konfigurér → Skabeloner, som
-- læser platform_templates direkte.
--
-- Tokens (samme i alle fem): {{recipient_name}} {{resource_name}}
-- {{booking_time}} {{booking_title}} {{employee_name}} {{company_name}}.
-- {{booking_time}} er hele tidsrummet som læsbar tekst, dannet af dispatcheren
-- — ikke en dato, fordi en booking kan spænde over flere døgn.
-- ---------------------------------------------------------------------------
insert into public.platform_templates (key, lang, name, kind, company_editable, title, body) values

-- ---- Oprettet -------------------------------------------------------------
('booking_created', 'da', 'Booking Created', 'text', true,
 'Booking bekræftet: {{resource_name}}',
 E'Hej {{recipient_name}},\n\nDin booking er oprettet.\n\n{{resource_name}}\n{{booking_time}}\n{{booking_title}}\n\nMed venlig hilsen\n{{company_name}}'),
('booking_created', 'en', 'Booking Created', 'text', true,
 'Booking confirmed: {{resource_name}}',
 E'Hi {{recipient_name}},\n\nYour booking has been created.\n\n{{resource_name}}\n{{booking_time}}\n{{booking_title}}\n\nKind regards\n{{company_name}}'),
('booking_created_sms', 'da', 'Booking Created (SMS)', 'text', true, '',
 'Booking bekræftet: {{resource_name}}, {{booking_time}}. Mvh {{company_name}}'),
('booking_created_sms', 'en', 'Booking Created (SMS)', 'text', true, '',
 'Booking confirmed: {{resource_name}}, {{booking_time}}. Regards {{company_name}}'),
('booking_created_slack', 'da', 'Booking Created (Slack)', 'text', true, '',
 E'Din booking er oprettet — {{resource_name}}, {{booking_time}}.\n{{booking_title}}\n\n{{company_name}}'),
('booking_created_slack', 'en', 'Booking Created (Slack)', 'text', true, '',
 E'Your booking has been created — {{resource_name}}, {{booking_time}}.\n{{booking_title}}\n\n{{company_name}}'),
('booking_created_teams', 'da', 'Booking Created (Teams)', 'text', true, '',
 E'Din booking er oprettet — {{resource_name}}, {{booking_time}}.\n{{booking_title}}\n\n{{company_name}}'),
('booking_created_teams', 'en', 'Booking Created (Teams)', 'text', true, '',
 E'Your booking has been created — {{resource_name}}, {{booking_time}}.\n{{booking_title}}\n\n{{company_name}}'),

-- ---- Ændret ---------------------------------------------------------------
('booking_updated', 'da', 'Booking Changed', 'text', true,
 'Booking ændret: {{resource_name}}',
 E'Hej {{recipient_name}},\n\nDin booking er ændret. Den gælder nu:\n\n{{resource_name}}\n{{booking_time}}\n{{booking_title}}\n\nMed venlig hilsen\n{{company_name}}'),
('booking_updated', 'en', 'Booking Changed', 'text', true,
 'Booking changed: {{resource_name}}',
 E'Hi {{recipient_name}},\n\nYour booking has been changed. It now applies to:\n\n{{resource_name}}\n{{booking_time}}\n{{booking_title}}\n\nKind regards\n{{company_name}}'),
('booking_updated_sms', 'da', 'Booking Changed (SMS)', 'text', true, '',
 'Booking ændret: {{resource_name}}, {{booking_time}}. Mvh {{company_name}}'),
('booking_updated_sms', 'en', 'Booking Changed (SMS)', 'text', true, '',
 'Booking changed: {{resource_name}}, {{booking_time}}. Regards {{company_name}}'),
('booking_updated_slack', 'da', 'Booking Changed (Slack)', 'text', true, '',
 E'Din booking er ændret — gælder nu {{resource_name}}, {{booking_time}}.\n\n{{company_name}}'),
('booking_updated_slack', 'en', 'Booking Changed (Slack)', 'text', true, '',
 E'Your booking has changed — now {{resource_name}}, {{booking_time}}.\n\n{{company_name}}'),
('booking_updated_teams', 'da', 'Booking Changed (Teams)', 'text', true, '',
 E'Din booking er ændret — gælder nu {{resource_name}}, {{booking_time}}.\n\n{{company_name}}'),
('booking_updated_teams', 'en', 'Booking Changed (Teams)', 'text', true, '',
 E'Your booking has changed — now {{resource_name}}, {{booking_time}}.\n\n{{company_name}}'),

-- ---- Annulleret -----------------------------------------------------------
('booking_cancelled', 'da', 'Booking Cancelled', 'text', true,
 'Booking annulleret: {{resource_name}}',
 E'Hej {{recipient_name}},\n\nDenne booking er annulleret:\n\n{{resource_name}}\n{{booking_time}}\n{{booking_title}}\n\nMed venlig hilsen\n{{company_name}}'),
('booking_cancelled', 'en', 'Booking Cancelled', 'text', true,
 'Booking cancelled: {{resource_name}}',
 E'Hi {{recipient_name}},\n\nThis booking has been cancelled:\n\n{{resource_name}}\n{{booking_time}}\n{{booking_title}}\n\nKind regards\n{{company_name}}'),
('booking_cancelled_sms', 'da', 'Booking Cancelled (SMS)', 'text', true, '',
 'Booking annulleret: {{resource_name}}, {{booking_time}}. Mvh {{company_name}}'),
('booking_cancelled_sms', 'en', 'Booking Cancelled (SMS)', 'text', true, '',
 'Booking cancelled: {{resource_name}}, {{booking_time}}. Regards {{company_name}}'),
('booking_cancelled_slack', 'da', 'Booking Cancelled (Slack)', 'text', true, '',
 E'Booking annulleret — {{resource_name}}, {{booking_time}}.\n\n{{company_name}}'),
('booking_cancelled_slack', 'en', 'Booking Cancelled (Slack)', 'text', true, '',
 E'Booking cancelled — {{resource_name}}, {{booking_time}}.\n\n{{company_name}}'),
('booking_cancelled_teams', 'da', 'Booking Cancelled (Teams)', 'text', true, '',
 E'Booking annulleret — {{resource_name}}, {{booking_time}}.\n\n{{company_name}}'),
('booking_cancelled_teams', 'en', 'Booking Cancelled (Teams)', 'text', true, '',
 E'Booking cancelled — {{resource_name}}, {{booking_time}}.\n\n{{company_name}}'),

-- ---- Påmindelse -----------------------------------------------------------
('booking_reminder', 'da', 'Booking Reminder', 'text', true,
 'Påmindelse: {{resource_name}}',
 E'Hej {{recipient_name}},\n\nDin booking begynder snart.\n\n{{resource_name}}\n{{booking_time}}\n{{booking_title}}\n\nMed venlig hilsen\n{{company_name}}'),
('booking_reminder', 'en', 'Booking Reminder', 'text', true,
 'Reminder: {{resource_name}}',
 E'Hi {{recipient_name}},\n\nYour booking starts soon.\n\n{{resource_name}}\n{{booking_time}}\n{{booking_title}}\n\nKind regards\n{{company_name}}'),
('booking_reminder_sms', 'da', 'Booking Reminder (SMS)', 'text', true, '',
 'Påmindelse: {{resource_name}}, {{booking_time}}. Mvh {{company_name}}'),
('booking_reminder_sms', 'en', 'Booking Reminder (SMS)', 'text', true, '',
 'Reminder: {{resource_name}}, {{booking_time}}. Regards {{company_name}}'),
('booking_reminder_slack', 'da', 'Booking Reminder (Slack)', 'text', true, '',
 E'Påmindelse — {{resource_name}}, {{booking_time}}.\n{{booking_title}}\n\n{{company_name}}'),
('booking_reminder_slack', 'en', 'Booking Reminder (Slack)', 'text', true, '',
 E'Reminder — {{resource_name}}, {{booking_time}}.\n{{booking_title}}\n\n{{company_name}}'),
('booking_reminder_teams', 'da', 'Booking Reminder (Teams)', 'text', true, '',
 E'Påmindelse — {{resource_name}}, {{booking_time}}.\n{{booking_title}}\n\n{{company_name}}'),
('booking_reminder_teams', 'en', 'Booking Reminder (Teams)', 'text', true, '',
 E'Reminder — {{resource_name}}, {{booking_time}}.\n{{booking_title}}\n\n{{company_name}}'),

-- ---- Sendt til fakturering ------------------------------------------------
-- Går til økonomipostkassen, ikke til medarbejderen: modtageren er den der skal
-- handle på fakturagrundlaget. Derfor nævner teksten medarbejderen ved navn.
('booking_invoiced', 'da', 'Booking Invoiced', 'text', true,
 'Booking sendt til fakturering: {{resource_name}}',
 E'En booking er markeret som faktureret.\n\n{{resource_name}}\n{{booking_time}}\n{{booking_title}}\nMedarbejder: {{employee_name}}\n\n{{company_name}}'),
('booking_invoiced', 'en', 'Booking Invoiced', 'text', true,
 'Booking sent for invoicing: {{resource_name}}',
 E'A booking has been marked as invoiced.\n\n{{resource_name}}\n{{booking_time}}\n{{booking_title}}\nEmployee: {{employee_name}}\n\n{{company_name}}'),
('booking_invoiced_sms', 'da', 'Booking Invoiced (SMS)', 'text', true, '',
 'Booking faktureret: {{resource_name}}, {{booking_time}}. {{company_name}}'),
('booking_invoiced_sms', 'en', 'Booking Invoiced (SMS)', 'text', true, '',
 'Booking invoiced: {{resource_name}}, {{booking_time}}. {{company_name}}'),
('booking_invoiced_slack', 'da', 'Booking Invoiced (Slack)', 'text', true, '',
 E'Booking faktureret — {{resource_name}}, {{booking_time}} ({{employee_name}}).\n\n{{company_name}}'),
('booking_invoiced_slack', 'en', 'Booking Invoiced (Slack)', 'text', true, '',
 E'Booking invoiced — {{resource_name}}, {{booking_time}} ({{employee_name}}).\n\n{{company_name}}'),
('booking_invoiced_teams', 'da', 'Booking Invoiced (Teams)', 'text', true, '',
 E'Booking faktureret — {{resource_name}}, {{booking_time}} ({{employee_name}}).\n\n{{company_name}}'),
('booking_invoiced_teams', 'en', 'Booking Invoiced (Teams)', 'text', true, '',
 E'Booking invoiced — {{resource_name}}, {{booking_time}} ({{employee_name}}).\n\n{{company_name}}')

on conflict (key, lang) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Planlægning: pg_cron kalder dispatcheren hvert 5. minut — samme kadence,
-- autorisation og selv-tavshed som pakke-dispatcheren. Ingenting sker før
-- hovedafbryderen er slået til OG Vault-hemmeligheden findes.
-- ---------------------------------------------------------------------------
select cron.schedule('operia-booking-notifications', '*/5 * * * *', $job$
do $inner$
begin
  if (select booking_notifications_enabled from public.platform_settings limit 1)
     and (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key') is not null
  then
    perform net.http_post(
      url := 'https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/dispatch-booking-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := jsonb_build_object('mode', 'dispatch')
    );
  end if;
end
$inner$;
$job$);

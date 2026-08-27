-- Salgs-leads fra besparelsesberegneren på operia-info.predictioninstitute.com
-- ("Få beregningen på mail"). Skrives KUN af sales-lead-edge-funktionen
-- (service_role) — siden er offentlig og anonym, så ingen klient-insert.
-- Læses af platform-admins (det er DCA's salgsindbakke, ligesom feedback).
--
-- GDPR: formålet er at sende den ønskede beregning og — hvis afsenderen har
-- bedt om det (want_demo) — at kontakte vedkommende om en demo. ip/user_agent
-- gemmes alene til misbrugsbegrænsning (rate limit) og ryddes op sammen med
-- rækken. Leads uden demo-ønske er uden videre forpligtelse og purges efter
-- 12 måneder; se purge-jobbet nederst.

create table public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,
  name text,
  company text,
  want_demo boolean not null default false,
  theme text not null default 'blue' check (theme in ('blue', 'operia')),
  params jsonb not null default '{}'::jsonb, -- indsendte moduler/felter (validerede)
  total_kr numeric not null default 0,       -- serverens egen genberegning
  email_sent boolean not null default false,
  email_error text,
  ip inet,          -- kun rate limit
  user_agent text   -- kun rate limit/fejlsøgning
);

create index sales_leads_created_idx on public.sales_leads (created_at desc);
-- Rate limit-opslag i edge-funktionen: pr. e-mail og pr. IP over et tidsrum.
create index sales_leads_email_idx on public.sales_leads (email, created_at desc);
create index sales_leads_ip_idx on public.sales_leads (ip, created_at desc);

alter table public.sales_leads enable row level security;

-- Læs: kun platform-admins (DCA). Ingen insert/update/delete fra klienter —
-- edge-funktionen bruger service_role, som omgår RLS.
create policy sales_leads_select on public.sales_leads
  for select to authenticated
  using (public.is_platform_admin());

revoke all on public.sales_leads from anon;
revoke insert, update, delete on public.sales_leads from authenticated;
grant select on public.sales_leads to authenticated;

-- Oprydning: leads ældre end 12 måneder slettes (kørt af det natlige
-- pg_cron-vindue). Demo-ønsker er på det tidspunkt for længst fulgt op, og
-- rene beregnings-mails har ingen fortsat berettigelse.
select cron.schedule(
  'sales-leads-purge',
  '20 2 * * *', -- 02:20 hver nat
  $$ delete from public.sales_leads where created_at < now() - interval '12 months' $$
);

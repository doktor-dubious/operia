-- Udgivelses-kø for håndterminal-APK'en (Operia → Handheld-design → Handlinger).
-- Web-appen kan ikke selv bygge/signere APK'en (kræver JDK + signeringsnøgle på
-- byggemaskinen), så knappen indsætter en række her, og deploy-workeren på
-- byggemaskinen (android/deploy-worker.sh, service-role) udfører publish-apk.sh
-- og skriver status/log tilbage.

create table public.handheld_deploys (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references auth.users (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'success', 'failed')),
  log text, -- halen af scriptets output (sat af workeren)
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index handheld_deploys_created_idx on public.handheld_deploys (created_at desc);

-- Højst én aktiv udgivelse ad gangen: endnu et klik mens der bygges skal fejle
-- pænt (unique violation) i stedet for at stable en kø op.
create unique index handheld_deploys_one_active_idx on public.handheld_deploys ((true))
  where status in ('queued', 'running');

alter table public.handheld_deploys enable row level security;

-- Bestil: kun platform-admins (DCA), og kun i eget navn.
create policy handheld_deploys_insert on public.handheld_deploys
  for insert to authenticated
  with check (public.is_platform_admin() and requested_by = auth.uid());

-- Læs (status/historik): kun platform-admins.
create policy handheld_deploys_select on public.handheld_deploys
  for select to authenticated
  using (public.is_platform_admin());

-- Status/log opdateres kun af workeren (service role uden om RLS).
revoke update, delete on public.handheld_deploys from anon, authenticated;
grant select, insert on public.handheld_deploys to authenticated;

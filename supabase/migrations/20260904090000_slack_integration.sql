-- Slack-integration: OAuth-installation pr. kunde + bot-token.
--
-- Modsat Entra indtaster kunden INTET her. Flowet er OAuth: en manager trykker
-- "Forbind til Slack", godkender i sit eget workspace, og Slack sender browseren
-- tilbage til edge-funktionen slack-oauth, som bytter koden til et bot-token.
-- Konfigurationen skrives derfor udelukkende af service-role — der er bevidst
-- ingen skrive-politik for 'authenticated' på nogen af tabellerne her.
--
-- Hemmeligheden (bot-tokenet) følger mønsteret fra company_entra_secret:
-- en tabel uden RLS-politikker og uden grants, som kun edge-funktionerne rører.
-- UI'et ser kun spejlet 'token_set' i konfigurationen — aldrig tokenet selv.

-- ── Platformens udbud (som entra_enabled / ai_enabled) ──────────────────────
alter table public.platform_settings
  add column slack_enabled boolean not null default false;

-- ── Pr. kunde: forbindelsens tilstand (læsbar, ikke skrivbar, for kunden) ───
create table public.company_slack_config (
  company_id uuid primary key references public.companies (id) on delete cascade,
  -- Slack-workspacet installationen gælder. Gemmes for at kunne VISE hvilket
  -- workspace der er forbundet, og for at opdage at nogen har geninstalleret
  -- i et andet workspace end forventet.
  team_id text,
  team_name text,
  bot_user_id text,
  -- Spejles fra company_slack_secret af trigger nedenfor.
  token_set boolean not null default false,
  connected_at timestamptz,
  connected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger company_slack_config_set_updated_at
  before update on public.company_slack_config
  for each row execute function public.set_updated_at();

alter table public.company_slack_config enable row level security;

-- Kun læsning. Alt skrives af slack-oauth / slack-config (service-role), som
-- selv genverificerer at kalderen er manager i virksomheden.
create policy company_slack_config_select on public.company_slack_config
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

grant select on public.company_slack_config to authenticated;

-- ── Pr. kunde: bot-token (KUN service-role) ─────────────────────────────────
create table public.company_slack_secret (
  company_id uuid primary key references public.companies (id) on delete cascade,
  bot_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger company_slack_secret_set_updated_at
  before update on public.company_slack_secret
  for each row execute function public.set_updated_at();

alter table public.company_slack_secret enable row level security;
revoke all on public.company_slack_secret from anon, authenticated;

create or replace function public.sync_slack_secret_flag()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := coalesce(new.company_id, old.company_id);
  v_set boolean := coalesce(new.bot_token, '') <> '';
begin
  update public.company_slack_config
     set token_set = v_set
   where company_id = v_company;
  return coalesce(new, old);
end;
$$;

create trigger company_slack_secret_mirror_flag
  after insert or update or delete on public.company_slack_secret
  for each row execute function public.sync_slack_secret_flag();

-- ── OAuth-state: CSRF-værn på installationsflowet ───────────────────────────
-- slack-oauth kaldes af BROWSEREN efter Slacks omdirigering og har derfor ingen
-- Supabase-JWT. Autorisationen er denne state-nøgle: udstedt af slack-config
-- til en verificeret manager, umulig at gætte, ENGANGSBRUG og kortlivet. Uden
-- den kunne enhver kalde callback'et med en kode fra sit eget workspace og
-- binde det til en fremmed virksomhed.
create table public.slack_oauth_state (
  state text primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index slack_oauth_state_created_at_idx on public.slack_oauth_state (created_at);

alter table public.slack_oauth_state enable row level security;
revoke all on public.slack_oauth_state from anon, authenticated;

-- Udløbne states ryddes opportunistisk af slack-oauth (service-role) ved hvert
-- kald. Bevidst INGEN SQL-funktion til det: en 'create function' får som
-- udgangspunkt execute for PUBLIC, og et 'revoke ... from anon, authenticated'
-- fjerner ikke den PUBLIC-rettighed — så ville oprydningen kunne kaldes udefra.
-- Sletningen står derfor i edge-funktionen, hvor adgangen allerede er afgrænset.

comment on table public.company_slack_secret is
  'Bot-token pr. kunde. Ingen RLS-politikker og ingen grants — kun edge-funktioner (service-role) læser og skriver.';
comment on table public.slack_oauth_state is
  'Engangs-CSRF-nøgler til Slack OAuth. Ryddes efter 10 minutter af purge_slack_oauth_state().';

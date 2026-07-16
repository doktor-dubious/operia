-- Log drains (som Supabase Studios "Log Drains"): videresend revisionsloggen
-- (audit_log) til en ekstern observability-/SIEM-/lagerplatform i næsten
-- realtid. To niveauer:
--   * company_id = <kunde>  → kunden dræner sine egne audit-hændelser (NIS2:
--     videresend sikkerhedshændelser til kundens eget log-management).
--   * company_id = null     → platform-niveau (DCA dræner alt centralt).
-- Tre destinationer (metoden vælges pr. dræn): generisk HTTP/NDJSON, Datadog,
-- Grafana Loki. Selve leveringen sker server-side (Edge Function log-drain-
-- dispatch, kaldt af pg_cron) med et vandmærke (last_delivered_id), så
-- hændelser hverken tabes eller dubleres. Klienten er utroværdig: hemmeligheden
-- (token/api-nøgle) er skrive-kun — se kolonne-grants nedenfor.

create table public.log_drains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete cascade, -- null = platform-niveau
  name text not null,
  destination text not null default 'http' check (destination in ('http', 'datadog', 'loki')),
  endpoint text,                 -- http: POST-URL; loki: base-URL; datadog: ubrugt (site i config)
  secret text,                   -- token/api-nøgle — skrive-kun (revoke select nedenfor)
  secret_set boolean not null default false, -- klient-læsbar indikator for om secret er sat
  config jsonb not null default '{}'::jsonb, -- destinationsspecifikke valg (site/service/labels/…)
  enabled boolean not null default true,
  last_delivered_id bigint not null default 0, -- vandmærke: sidste leverede audit_log.id
  last_run_at timestamptz,
  last_status text check (last_status in ('ok', 'error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index log_drains_company_idx on public.log_drains (company_id);
create index log_drains_enabled_idx on public.log_drains (enabled) where enabled;

-- Sæt secret_set ud fra secret, og initialisér vandmærket til nuværende
-- maksimum ved oprettelse, så et nyt dræn kun videresender FREMTIDIGE hændelser
-- (ingen utilsigtet dump af hele historikken). SECURITY DEFINER: skal kunne læse
-- audit_log på tværs (platform-dræn) uafhængigt af kalderen.
create or replace function public.log_drains_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.secret_set := (new.secret is not null and length(btrim(new.secret)) > 0);
  if tg_op = 'INSERT' and coalesce(new.last_delivered_id, 0) = 0 then
    select coalesce(max(id), 0) into new.last_delivered_id
      from public.audit_log
     where new.company_id is null or company_id = new.company_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger log_drains_before_write_trg
  before insert or update on public.log_drains
  for each row execute function public.log_drains_before_write();

alter table public.log_drains enable row level security;

-- Læsning: platform-admins ser alle dræn (inkl. platform-niveau/null); en
-- kundes managers ser kun deres egen virksomheds dræn.
create policy log_drains_select on public.log_drains
  for select to authenticated
  using (public.is_platform_admin() or (company_id = public.current_company_id() and public.has_role('manager')));

-- Skrivning: samme afgrænsning. with check forhindrer en manager i at oprette
-- platform-dræn (null) eller dræn for en anden virksomhed.
create policy log_drains_write on public.log_drains
  for all to authenticated
  using (public.is_platform_admin() or (company_id = public.current_company_id() and public.has_role('manager')))
  with check (public.is_platform_admin() or (company_id = public.current_company_id() and public.has_role('manager')));

-- Kolonne-grants: klienten må skrive alt (inkl. secret), men aldrig LÆSE secret
-- tilbage. secret_set-indikatoren fortæller om en hemmelighed er sat.
grant select (
  id, company_id, name, destination, endpoint, config, enabled, secret_set,
  last_delivered_id, last_run_at, last_status, last_error, created_at, updated_at
) on public.log_drains to authenticated;
grant insert, update, delete on public.log_drains to authenticated;

-- Revisionslog: konfigurationsændringer logges (aldrig selve hemmeligheden).
-- Vandmærke-/status-opdateringer fra dispatcheren logges IKKE (kun ændringer i
-- de meningsbærende felter).
create or replace function public.audit_log_drains()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.record_audit(old.company_id, 'log_drain.deleted', 'log_drain', old.id::text, old.name);
    return old;
  end if;
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'log_drain.created', 'log_drain', new.id::text, new.name,
      jsonb_build_object('destination', new.destination, 'enabled', new.enabled));
    return new;
  end if;
  -- UPDATE: kun ved ændring i meningsbærende felter
  if (old.name, old.destination, old.endpoint, old.config, old.enabled, old.secret_set)
     is distinct from (new.name, new.destination, new.endpoint, new.config, new.enabled, new.secret_set) then
    perform public.record_audit(new.company_id, 'log_drain.updated', 'log_drain', new.id::text, new.name,
      jsonb_build_object('destination', new.destination, 'enabled', new.enabled));
  end if;
  return new;
end;
$$;

create trigger audit_log_drains_trg
  after insert or update or delete on public.log_drains
  for each row execute function public.audit_log_drains();

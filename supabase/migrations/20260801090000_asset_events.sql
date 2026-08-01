-- Aktiv-flowet, del 1: append-only hændelseslog (asset_events) + de kolonner
-- på assets som ind-/udtjekningsflowet kræver.
--
-- asset_events er aktivernes chain-of-custody, spejlet efter parcel_events:
-- immutabel (UPDATE/DELETE både revoked og trigger-blokeret), skrives kun af
-- SECURITY DEFINER-triggere/-RPC'er, læses i egen virksomhed. Ingen persondata
-- i detail — kun id-referencer (GDPR: loggen kan aldrig renses).
--
-- Hændelsestyper:
--   created | status_changed | moved | assigned_changed   (generisk trigger)
--   checked_out | checked_in | loaned                     (flow-RPC'er, del 3)
--   service_sent | retired | reinstated                   (retur fra service = checked_in)
--   documented                                            (asset_documents, del 2)

-- ---------------------------------------------------------------------------
-- Nye kolonner: hvem har aktivet, service-tilstand, udfasning
-- ---------------------------------------------------------------------------
alter table public.assets
  add column assigned_to_employee_id uuid references public.employees (id) on delete set null,
  add column assigned_at timestamptz,
  add column service_vendor text,
  add column service_expected_back date,
  add column retired_at timestamptz,
  add column retired_reason text;

comment on column public.assets.assigned_to_employee_id is
  'Medarbejderen der har aktivet (status assigned — eller service, hvis det var tildelt da det blev sendt til service).';

create index assets_company_status_idx on public.assets (company_id, status);
create index assets_assigned_to_idx on public.assets (assigned_to_employee_id);

-- ---------------------------------------------------------------------------
-- Tenant-guard (som parcels_guard): FK-opslag omgår RLS, så tilhørsforhold
-- valideres eksplicit. Dækker også importens skrivninger.
-- ---------------------------------------------------------------------------
create or replace function public.assets_guard()
returns trigger
language plpgsql
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.asset_categories c
    where c.id = new.category_id and c.company_id = new.company_id
  ) then
    raise exception 'Kategorien tilhører ikke virksomheden';
  end if;
  if new.location_id is not null and not exists (
    select 1 from public.asset_locations l
    where l.id = new.location_id and l.company_id = new.company_id
  ) then
    raise exception 'Placeringen tilhører ikke virksomheden';
  end if;
  if new.assigned_to_employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = new.assigned_to_employee_id and e.company_id = new.company_id
  ) then
    raise exception 'Medarbejderen tilhører ikke virksomheden';
  end if;
  return new;
end;
$$;

create trigger assets_guard
  before insert or update on public.assets
  for each row execute function public.assets_guard();

-- ---------------------------------------------------------------------------
-- Hændelsesloggen
-- ---------------------------------------------------------------------------
create table public.asset_events (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.assets (id) on delete restrict,
  company_id uuid not null references public.companies (id) on delete restrict,
  event_type text not null,
  from_status public.asset_status,
  to_status public.asset_status,
  from_location_id uuid, -- bevidst uden FK: loggen må aldrig ændres, heller ikke af cascades
  to_location_id uuid,
  actor_user_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index asset_events_asset_idx on public.asset_events (asset_id, created_at);
create index asset_events_company_idx on public.asset_events (company_id, created_at);

revoke update, delete on public.asset_events from anon, authenticated;

-- block_mutation er generaliseret i 20260715110000 (bruger tg_table_name).
-- Bemærk: asset_events er som parcel_events BEVIDST undtaget retention-purge —
-- det er chain of custody, ikke en logserie.
create trigger asset_events_immutable
  before update or delete on public.asset_events
  for each row execute function public.block_mutation();

-- ---------------------------------------------------------------------------
-- Generisk hændelseslogning på assets (SECURITY DEFINER: skriver uden om
-- klient-revokes). Flow-RPC'erne (del 3) skriver rigere, specifikke hændelser
-- selv og undertrykker den generiske logning med et transaktionslokalt flag
-- (operia.asset_flow_rpc) — PostgREST kører hvert kald i egen transaktion, så
-- flaget kan ikke lække. Direkte skrivninger (CSV-import, registerredigering)
-- logges altid her.
-- ---------------------------------------------------------------------------
create or replace function public.log_asset_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.asset_events
      (asset_id, company_id, event_type, to_status, to_location_id, actor_user_id, detail)
    values
      (new.id, new.company_id, 'created', new.status, new.location_id, auth.uid(),
       jsonb_build_object('asset_tag', new.asset_tag, 'barcode', new.barcode));
    return null;
  end if;

  if current_setting('operia.asset_flow_rpc', true) = '1' then
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.asset_events
      (asset_id, company_id, event_type, from_status, to_status,
       from_location_id, to_location_id, actor_user_id)
    values
      (new.id, new.company_id, 'status_changed', old.status, new.status,
       old.location_id, new.location_id, auth.uid());
  end if;
  if new.location_id is distinct from old.location_id then
    insert into public.asset_events
      (asset_id, company_id, event_type, from_status, to_status,
       from_location_id, to_location_id, actor_user_id)
    values
      (new.id, new.company_id, 'moved', old.status, new.status,
       old.location_id, new.location_id, auth.uid());
  end if;
  if new.assigned_to_employee_id is distinct from old.assigned_to_employee_id then
    insert into public.asset_events
      (asset_id, company_id, event_type, from_status, to_status, actor_user_id, detail)
    values
      (new.id, new.company_id, 'assigned_changed', old.status, new.status, auth.uid(),
       jsonb_build_object(
         'from_employee', old.assigned_to_employee_id,
         'to_employee', new.assigned_to_employee_id
       ));
  end if;
  return null;
end;
$$;

create trigger assets_log_event
  after insert or update on public.assets
  for each row execute function public.log_asset_event();

-- ---------------------------------------------------------------------------
-- RLS: læses i egen virksomhed; skrives KUN via triggere/RPC'er
-- ---------------------------------------------------------------------------
alter table public.asset_events enable row level security;

create policy asset_events_select on public.asset_events
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

grant select on public.asset_events to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: eksisterende aktiver får en 'created'-hændelse med aktivets egen
-- oprettelsestid, så tidslinjen starter samme sted som registeret.
-- ---------------------------------------------------------------------------
insert into public.asset_events
  (asset_id, company_id, event_type, to_status, to_location_id, detail, created_at)
select a.id, a.company_id, 'created', a.status, a.location_id,
       jsonb_build_object('asset_tag', a.asset_tag, 'barcode', a.barcode, 'backfilled', true),
       a.created_at
from public.assets a;

-- ---------------------------------------------------------------------------
-- Spejl til audit_log (som audit_parcel_events): minimeret detail — kun
-- statusser, plus udfasningsårsagen (preset-nøgle, ikke fritekst/persondata).
-- 'created' udelades: audit_assets_trg logger allerede asset.created.
-- Triggeren oprettes EFTER backfillen, så historikken ikke oversvømmer loggen.
-- ---------------------------------------------------------------------------
create or replace function public.audit_asset_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_type = 'created' then
    return new;
  end if;
  perform public.record_audit(
    new.company_id,
    'asset.' || new.event_type,
    'asset',
    new.asset_id::text,
    null,
    jsonb_build_object('from_status', new.from_status, 'to_status', new.to_status)
      || case
           when new.event_type = 'retired'
                and nullif(btrim(coalesce(new.detail->>'reason', '')), '') is not null
           then jsonb_build_object('reason', new.detail->>'reason')
           else '{}'::jsonb
         end,
    new.actor_user_id
  );
  return new;
end;
$$;

create trigger audit_asset_events_trg
  after insert on public.asset_events
  for each row execute function public.audit_asset_events();

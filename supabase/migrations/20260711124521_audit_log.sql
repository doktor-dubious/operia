-- NIS2-revisionslog: central, uforanderlig aktivitetslog. Poster skrives KUN
-- af SECURITY DEFINER-triggere, så en (utroværdig) klient hverken kan springe
-- logning over eller ændre/slette poster. Læsbar for egen virksomhed +
-- platform-admins. Ingen FK på company_id (loggen skal overleve sletning af
-- virksomheden), actor_user_id gemmes uden FK af samme grund.

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid,
  actor_user_id uuid,
  action text not null,        -- fx 'employee.deactivated', 'parcel.handover'
  entity_type text not null,   -- fx 'employee', 'location', 'parcel'
  entity_id text,
  summary text,                -- menneskelæsbar reference (navn/fil)
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_company_created_idx on public.audit_log (company_id, created_at desc);
create index audit_log_action_idx on public.audit_log (action);

alter table public.audit_log enable row level security;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

-- Kun læsning for klienter; skrivning sker via definer-triggere.
grant select on public.audit_log to authenticated;
revoke insert, update, delete on public.audit_log from anon, authenticated;

-- Uforanderlighed: genbrug den eksisterende blokeringstrigger.
create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.block_mutation();

-- ---------------------------------------------------------------------------
-- Central skrive-helper (SECURITY DEFINER). Kun tilgængelig for triggerne;
-- execute fjernes fra klientroller, så den ikke kan misbruges via RPC.
-- ---------------------------------------------------------------------------
create or replace function public.record_audit(
  p_company_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_summary text,
  p_detail jsonb default '{}'::jsonb,
  p_actor uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (company_id, actor_user_id, action, entity_type, entity_id, summary, detail)
  values (p_company_id, coalesce(p_actor, auth.uid()), p_action, p_entity_type, p_entity_id, p_summary,
          coalesce(p_detail, '{}'::jsonb));
end;
$$;

revoke execute on function public.record_audit(uuid, text, text, text, text, jsonb, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Anonymiseringsmarkør: gør det muligt for triggeren at skelne anonymisering
-- (GDPR) fra almindelig deaktivering.
-- ---------------------------------------------------------------------------
alter table public.employees add column anonymized_at timestamptz;

-- ---------------------------------------------------------------------------
-- Triggerfunktioner (alle SECURITY DEFINER). Én pr. tabel.
-- ---------------------------------------------------------------------------
create or replace function public.audit_employees()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.record_audit(old.company_id, 'employee.deleted', 'employee', old.id::text, old.full_name);
    return old;
  elsif tg_op = 'UPDATE' then
    if new.anonymized_at is not null and old.anonymized_at is null then
      -- Undgå at logge selve persondataen der lige er slettet (GDPR): referér id/nr.
      perform public.record_audit(new.company_id, 'employee.anonymized', 'employee', new.id::text,
        coalesce(old.employee_no, new.id::text));
    elsif old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'employee.deactivated', 'employee', new.id::text, new.full_name);
    end if;
    return new;
  end if;
  return null;
end;
$$;

create or replace function public.audit_departments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit(old.company_id, 'department.deleted', 'department', old.id::text, old.name);
  return old;
end;
$$;

create or replace function public.audit_locations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'location.created', 'location', new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'location.deactivated', 'location', new.id::text, new.name);
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'location.deleted', 'location', old.id::text, old.name);
    return old;
  end if;
end;
$$;

create or replace function public.audit_handling_classes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'handling_class.created', 'handling_class', new.id::text, new.name);
    return new;
  else
    perform public.record_audit(old.company_id, 'handling_class.deleted', 'handling_class', old.id::text, old.name);
    return old;
  end if;
end;
$$;

create or replace function public.audit_carriers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'carrier.created', 'carrier', new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'carrier.deactivated', 'carrier', new.id::text, new.name);
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'carrier.deleted', 'carrier', old.id::text, old.name);
    return old;
  end if;
end;
$$;

create or replace function public.audit_lockers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'locker.created', 'locker', new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active and not new.is_active then
      perform public.record_audit(new.company_id, 'locker.deactivated', 'locker', new.id::text, new.name);
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'locker.deleted', 'locker', old.id::text, old.name);
    return old;
  end if;
end;
$$;

create or replace function public.audit_app_users()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'user.invited', 'app_user', new.user_id::text,
      coalesce(nullif(new.full_name, ''), new.email));
    return new;
  else
    perform public.record_audit(old.company_id, 'user.removed', 'app_user', old.user_id::text,
      coalesce(nullif(old.full_name, ''), old.email));
    return old;
  end if;
end;
$$;

create or replace function public.audit_import_runs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit(new.company_id, 'import.' || new.status, 'import', new.id::text, new.file_name,
    jsonb_build_object('status', new.status, 'created', new.created_count, 'updated', new.updated_count,
                       'deactivated', new.deactivated_count, 'rejected', new.rejected_count),
    new.created_by);
  return new;
end;
$$;

-- Spejl pakkehændelser (modtag/udlever/flyt) ind i den samlede log.
create or replace function public.audit_parcel_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.record_audit(new.company_id, 'parcel.' || new.event_type, 'parcel', new.parcel_id::text, null,
    jsonb_build_object('from_status', new.from_status, 'to_status', new.to_status),
    new.actor_user_id);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggere
-- ---------------------------------------------------------------------------
create trigger audit_employees_trg after update or delete on public.employees
  for each row execute function public.audit_employees();
create trigger audit_departments_trg after delete on public.departments
  for each row execute function public.audit_departments();
create trigger audit_locations_trg after insert or update or delete on public.storage_locations
  for each row execute function public.audit_locations();
create trigger audit_handling_classes_trg after insert or delete on public.handling_classes
  for each row execute function public.audit_handling_classes();
create trigger audit_carriers_trg after insert or update or delete on public.carriers
  for each row execute function public.audit_carriers();
create trigger audit_lockers_trg after insert or update or delete on public.lockers
  for each row execute function public.audit_lockers();
create trigger audit_app_users_trg after insert or delete on public.app_users
  for each row execute function public.audit_app_users();
create trigger audit_import_runs_trg after insert on public.import_runs
  for each row execute function public.audit_import_runs();
create trigger audit_parcel_events_trg after insert on public.parcel_events
  for each row execute function public.audit_parcel_events();

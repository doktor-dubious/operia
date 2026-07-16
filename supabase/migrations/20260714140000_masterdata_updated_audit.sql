-- Redigering af app-ejet stamdata (placeringer, håndteringsklasser, fragtfirmaer,
-- skabe) skal også fanges i revisionsloggen — indtil nu loggede triggerne kun
-- oprettelse, deaktivering og sletning, så en manager kunne omdøbe eller ændre
-- felter uden spor. Vi tilføjer en '<entity>.updated'-handling for almindelige
-- feltændringer og '<entity>.activated' som modstykke til den eksisterende
-- deaktivering. Kategori/niveau udledes automatisk af de genererede kolonner
-- ('*.updated'/'*.activated' → niveau success, kategori config/lockers), så
-- ingen ændringer i Logs-fremviseren er nødvendige.
--
-- handling_classes havde slet ingen UPDATE-gren: triggeren lyttede kun på
-- insert/delete. Den genskabes med update inkluderet.

create or replace function public.audit_locations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'location.created', 'location', new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active is distinct from new.is_active then
      perform public.record_audit(new.company_id,
        case when new.is_active then 'location.activated' else 'location.deactivated' end,
        'location', new.id::text, new.name);
    else
      perform public.record_audit(new.company_id, 'location.updated', 'location', new.id::text, new.name);
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
  elsif tg_op = 'UPDATE' then
    perform public.record_audit(new.company_id, 'handling_class.updated', 'handling_class', new.id::text, new.name);
    return new;
  else
    perform public.record_audit(old.company_id, 'handling_class.deleted', 'handling_class', old.id::text, old.name);
    return old;
  end if;
end;
$$;

-- handling_classes-triggeren lyttede kun på insert/delete — genskab med update.
drop trigger if exists audit_handling_classes_trg on public.handling_classes;
create trigger audit_handling_classes_trg
  after insert or update or delete on public.handling_classes
  for each row execute function public.audit_handling_classes();

create or replace function public.audit_carriers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'carrier.created', 'carrier', new.id::text, new.name);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.is_active is distinct from new.is_active then
      perform public.record_audit(new.company_id,
        case when new.is_active then 'carrier.activated' else 'carrier.deactivated' end,
        'carrier', new.id::text, new.name);
    else
      perform public.record_audit(new.company_id, 'carrier.updated', 'carrier', new.id::text, new.name);
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
    if old.is_active is distinct from new.is_active then
      perform public.record_audit(new.company_id,
        case when new.is_active then 'locker.activated' else 'locker.deactivated' end,
        'locker', new.id::text, new.name);
    else
      perform public.record_audit(new.company_id, 'locker.updated', 'locker', new.id::text, new.name);
    end if;
    return new;
  else
    perform public.record_audit(old.company_id, 'locker.deleted', 'locker', old.id::text, old.name);
    return old;
  end if;
end;
$$;

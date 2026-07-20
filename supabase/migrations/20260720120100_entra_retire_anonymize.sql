-- Fratrådte medarbejdere: EX-markering og efterfølgende anonymisering.
--
-- Livscyklus når politikken "anonymiser fratrådte" er slået til og en
-- medarbejder forsvinder fra Entra:
--   har åbne pakker  → deaktiveres, retired_at sættes, navnet får "EX-" foran,
--                      så manageren kan sortere de resterende pakker ud.
--   ingen åbne pakker → anonymiseres med det samme.
-- Når den sidste pakke lukkes (udleveret/afvist/returneret), anonymiseres
-- medarbejderen automatisk.
--
-- Genkomst: en fratrådt-men-endnu-ikke-anonymiseret medarbejder genkendes på
-- external_id (Entra-GUID) og får EX-markeringen fjernet. Efter anonymisering
-- er koblingen til personen med vilje brudt — external_id og medarbejder-nr.
-- nulstilles — så en genansat kommer ind som en ny, ren medarbejder. Det er
-- hele pointen med anonymisering; kunne rækken genoplives, var den ikke
-- anonym.

alter table public.employees
  add column retired_at timestamptz;

comment on column public.employees.retired_at is
  'Fratrådt (forsvundet fra AD) men afventer at åbne pakker lukkes; navnet er EX-markeret.';

-- Fratrådte er is_active = false og fanges derfor allerede af modtagersøgningen
-- ved intake (employee-picker filtrerer på is_active) — der kan ikke oprettes
-- nye pakker til dem. Indekset her er til oprydnings-sweepet.
create index employees_retired_idx on public.employees (company_id)
  where retired_at is not null and anonymized_at is null;

-- ---------------------------------------------------------------------------
-- Åbne pakker = alt der ikke er nået til en slutstatus.
-- ---------------------------------------------------------------------------
create or replace function public.employee_has_open_parcels(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.parcels p
     where p.receiver_employee_id = p_employee_id
       and p.status not in ('delivered', 'rejected', 'returned')
  );
$$;

-- ---------------------------------------------------------------------------
-- Anonymisering (GDPR). Bruges både af den manuelle handling i /employees og
-- af AD-synkroniseringen, så de to veje ikke kan komme til at rydde
-- forskellige felter.
-- ---------------------------------------------------------------------------
create or replace function public.anonymize_employee(
  p_employee_id uuid,
  p_label text default 'Anonymiseret medarbejder'
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.employees where id = p_employee_id;
  if v_company is null then
    raise exception 'employee_not_found';
  end if;
  -- auth.uid() er null når synkroniseringen kalder med service-role.
  if auth.uid() is not null
     and not public.is_platform_admin()
     and not (v_company = public.current_company_id() and public.has_role('manager')) then
    raise exception 'not_authorized';
  end if;

  update public.employees
     set full_name = p_label,
         first_name = null,
         last_name = null,
         initials = null,
         email = null,
         phone = null,
         nfc_card_id = null,
         employee_no = null,
         -- Koblingen til personen brydes: rækken må aldrig kunne matches til
         -- en Entra-bruger igen (og frigør den unikke nøgle til en genansat).
         external_id = null,
         retired_at = null,
         is_active = false,
         anonymized_at = now()
   where id = p_employee_id
     and anonymized_at is null;
end;
$$;

grant execute on function public.anonymize_employee(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Fratrædelse: kaldes af synkroniseringen i stedet for en ren deaktivering.
-- ---------------------------------------------------------------------------
create or replace function public.retire_employee(
  p_employee_id uuid,
  p_anonymize boolean,
  p_label text default 'Anonymiseret medarbejder'
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not p_anonymize then
    update public.employees set is_active = false where id = p_employee_id;
    return 'deactivated';
  end if;

  if public.employee_has_open_parcels(p_employee_id) then
    select full_name into v_name from public.employees where id = p_employee_id;
    update public.employees
       set is_active = false,
           retired_at = coalesce(retired_at, now()),
           -- Idempotent: gentagne synk må ikke give "EX-EX-EX-".
           full_name = case when v_name like 'EX-%' then v_name else 'EX-' || v_name end
     where id = p_employee_id;
    return 'retired';
  end if;

  perform public.anonymize_employee(p_employee_id, p_label);
  return 'anonymized';
end;
$$;

-- ---------------------------------------------------------------------------
-- Genkomst før anonymisering: fjern EX-markeringen igen.
-- ---------------------------------------------------------------------------
create or replace function public.unretire_employee(p_employee_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.employees
     set retired_at = null,
         is_active = true,
         full_name = case when full_name like 'EX-%' then substring(full_name from 4) else full_name end
   where id = p_employee_id
     and anonymized_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Oprydning: anonymiser fratrådte der ikke længere har åbne pakker.
-- Kaldes efter hver synk (fanger dem hvor politikken lige er slået til) og af
-- triggeren nedenfor (fanger den sidste pakke der lukkes).
-- ---------------------------------------------------------------------------
create or replace function public.sweep_retired_employees(
  p_company_id uuid,
  p_label text default 'Anonymiseret medarbejder'
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select id from public.employees
     where company_id = p_company_id
       and retired_at is not null
       and anonymized_at is null
  loop
    if not public.employee_has_open_parcels(v_id) then
      perform public.anonymize_employee(v_id, p_label);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Når en pakke når en slutstatus: var det den sidste åbne pakke for en
-- fratrådt medarbejder, anonymiseres vedkommende med det samme.
-- ---------------------------------------------------------------------------
create or replace function public.anonymize_on_parcel_closed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.receiver_employee_id is not null
     and new.status in ('delivered', 'rejected', 'returned')
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and exists (
       select 1 from public.employees e
        where e.id = new.receiver_employee_id
          and e.retired_at is not null
          and e.anonymized_at is null
     )
     and not public.employee_has_open_parcels(new.receiver_employee_id) then
    perform public.anonymize_employee(new.receiver_employee_id);
  end if;
  return new;
end;
$$;

create trigger parcels_anonymize_retired_receiver
  after insert or update of status on public.parcels
  for each row execute function public.anonymize_on_parcel_closed();

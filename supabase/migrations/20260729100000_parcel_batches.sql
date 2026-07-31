-- Batch-modtagelse: en fragtmand afleverer nogle gange en hel kurv af pakker
-- (fx 25) til ÉN modtager, hver med sin egen stregkode. En batch samler dem, så:
--   • der sendes ÉN ankomst-notifikation for hele batchen (ikke 25),
--   • der kan printes én batch-label med en scanbar batch-kode (kun web),
--   • udlevering/afvisning kan ske for hele batchen ved at scanne én pakke
--     ELLER batch-labelen.
--
-- En batch har præcis én modtager — det er hele pointen (én besked til én
-- person). Det håndhæves i parcels_guard: en pakke i en batch får altid
-- batchens modtager. Batchen er "open" mens den scannes og "finished" når
-- receptionisten afslutter den; kun 'finished' batches notificeres/labelles.

create type public.batch_status as enum ('open', 'finished');

create table public.parcel_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Scanbar identifikator. 'OPB-' + 8 tegn: adskilt fra pakkekoder ('OPR-...'
  -- tilfældig, 'OPERIA-...' sekventiel), så en scanning entydigt er batch vs. pakke.
  batch_code text not null,
  receiver_employee_id uuid not null references public.employees (id) on delete restrict,
  department_id uuid references public.departments (id) on delete set null,
  status public.batch_status not null default 'open',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (company_id, batch_code)
);

create index parcel_batches_company_status_idx on public.parcel_batches (company_id, status);

create trigger parcel_batches_set_updated_at
  before update on public.parcel_batches
  for each row execute function public.set_updated_at();

-- Batch-kode: 'OPB-' + 8 tegn fra det utvetydige alfabet (uden 0/O/1/I), samme
-- princip som generate_parcel_barcode. Løkken sikrer unikhed i virksomheden.
create or replace function public.generate_batch_code(p_company_id uuid)
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  candidate text;
  i int;
begin
  loop
    candidate := 'OPB-';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.parcel_batches
      where company_id = p_company_id and batch_code = candidate
    );
  end loop;
  return candidate;
end;
$$;

-- Batch-guard (samme mønster som parcels_guard): genererer batch_code hvis
-- ingen er sat, validerer tenant-tilhør (FK-opslag omgår RLS), og sætter
-- finished_at når status skifter til 'finished'.
create or replace function public.parcel_batches_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.batch_code := nullif(btrim(coalesce(new.batch_code, '')), '');
    if new.batch_code is null then
      new.batch_code := public.generate_batch_code(new.company_id);
    end if;
  end if;

  if (tg_op = 'INSERT' and new.status = 'finished' and new.finished_at is null)
     or (tg_op = 'UPDATE' and new.status = 'finished'
         and old.status is distinct from 'finished' and new.finished_at is null) then
    new.finished_at := now();
  end if;

  if not exists (
    select 1 from public.employees e
    where e.id = new.receiver_employee_id and e.company_id = new.company_id
  ) then
    raise exception 'Modtager tilhører ikke virksomheden';
  end if;
  if new.department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = new.department_id and d.company_id = new.company_id
  ) then
    raise exception 'Afdeling tilhører ikke virksomheden';
  end if;

  return new;
end;
$$;

create trigger parcel_batches_guard
  before insert or update on public.parcel_batches
  for each row execute function public.parcel_batches_guard();

-- Pakkens tilknytning til en batch. on delete set null: en slettet batch
-- efterlader pakkerne intakt (historik/chain-of-custody bevares).
alter table public.parcels
  add column batch_id uuid references public.parcel_batches (id) on delete set null;

create index parcels_company_batch_idx on public.parcels (company_id, batch_id);

-- parcels_guard genskabes fra den SENESTE version (20260720060604 +
-- carrier-tjek fra 20260717190000) og udvides med batch-håndtering.
-- Lærestreg (se 20260717190000): «create or replace» skal altid tage
-- udgangspunkt i den seneste version, ellers tabes tidligere tilføjelser.
create or replace function public.parcels_guard()
returns trigger
language plpgsql
as $$
declare
  v_batch_receiver uuid;
begin
  -- Batch: valider tenant og TVING modtager = batchens modtager. Så forbliver
  -- en batch enmodtager, uanset hvad klienten sender (håndhæver invarianten
  -- som "én besked til én person" bygger på). Skal ske før status-logikken
  -- nedenfor, så en batch-pakke får en modtager og dermed status 'registered'.
  if new.batch_id is not null then
    select b.receiver_employee_id into v_batch_receiver
    from public.parcel_batches b
    where b.id = new.batch_id and b.company_id = new.company_id;
    if not found then
      raise exception 'Batch tilhører ikke virksomheden';
    end if;
    new.receiver_employee_id := v_batch_receiver;
  end if;

  if tg_op = 'INSERT' then
    -- Tom/blank stregkode behandles som ingen stregkode.
    new.barcode := nullif(btrim(coalesce(new.barcode, '')), '');
    if new.barcode is null then
      new.barcode := public.generate_parcel_barcode(new.company_id);
    end if;

    -- Uden matchet modtager starter pakken som 'unassigned' (spec Flow 1).
    if new.receiver_employee_id is null and new.status not in ('unassigned') then
      new.status := 'unassigned';
    end if;
    if new.receiver_employee_id is not null and new.status = 'unassigned' then
      new.status := 'registered';
    end if;
  elsif new.status is distinct from old.status then
    if not public.parcel_transition_allowed(old.status, new.status) then
      raise exception 'Ugyldig statusovergang: % -> %', old.status, new.status;
    end if;
    if new.status = 'delivered' and new.delivered_at is null then
      new.delivered_at := now();
    end if;
    -- Pakken har forladt huset ⇒ den står ikke længere nogen steder.
    -- Bemærk: 'rejected' er med vilje IKKE med — se 20260717180000.
    if new.status in ('delivered', 'returned') then
      new.storage_location_id := null;
    end if;
  end if;

  -- FK-opslag omgår RLS, så tenant-tilhør valideres eksplicit her.
  if new.receiver_employee_id is not null and not exists (
    select 1 from public.employees e
    where e.id = new.receiver_employee_id and e.company_id = new.company_id
  ) then
    raise exception 'Modtager tilhører ikke virksomheden';
  end if;
  if new.department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = new.department_id and d.company_id = new.company_id
  ) then
    raise exception 'Afdeling tilhører ikke virksomheden';
  end if;
  if new.storage_location_id is not null and not exists (
    select 1 from public.storage_locations sl
    where sl.id = new.storage_location_id and sl.company_id = new.company_id
  ) then
    raise exception 'Placering tilhører ikke virksomheden';
  end if;
  if new.handling_class_id is not null and not exists (
    select 1 from public.handling_classes hc
    where hc.id = new.handling_class_id and hc.company_id = new.company_id
  ) then
    raise exception 'Håndteringsklasse tilhører ikke virksomheden';
  end if;
  if new.carrier_id is not null and not exists (
    select 1 from public.carriers c
    where c.id = new.carrier_id and c.company_id = new.company_id
  ) then
    raise exception 'Fragtfirma tilhører ikke virksomheden';
  end if;

  return new;
end;
$$;

-- ── RLS: samme mønster som parcels — handlers og managers arbejder med batches,
-- ingen hard delete fra klienter. ───────────────────────────────────────────
alter table public.parcel_batches enable row level security;

create policy parcel_batches_select on public.parcel_batches
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy parcel_batches_insert on public.parcel_batches
  for insert to authenticated
  with check (
    (
      company_id = public.current_company_id()
      and (public.has_role('parcel_handler') or public.has_role('manager'))
    )
    or public.is_platform_admin()
  );

create policy parcel_batches_update on public.parcel_batches
  for update to authenticated
  using (
    (
      company_id = public.current_company_id()
      and (public.has_role('parcel_handler') or public.has_role('manager'))
    )
    or public.is_platform_admin()
  )
  with check (
    company_id = public.current_company_id() or public.is_platform_admin()
  );

grant select, insert, update on public.parcel_batches to authenticated; -- ingen delete fra klienter

-- "Generér stregkode" på Modtag pakke (web): når pakkens egen stregkode ikke
-- kan læses, skal handleren kunne trykke én knap, få en kode og printe en ny
-- label. Koden er FORTLØBENDE pr. virksomhed (OPERIA-000042) — modsat den
-- tilfældige OPR-kode, parcels_guard laver, når der slet ikke blev scannet
-- noget. Fortløbende, fordi mennesker læser og indtaster netop denne kode i
-- hånden; huller er i orden (en genereret kode, der aldrig blev gemt).
--
-- Nummeret ligger i sin egen tæller frem for max(barcode)+1: en scannet
-- fremmed stregkode må ikke kunne flytte rækkefølgen, og to samtidige
-- modtagelser skal ikke kunne få samme nummer.

create table public.parcel_barcode_seq (
  company_id uuid primary key references public.companies (id) on delete cascade,
  last_value bigint not null default 0
);

alter table public.parcel_barcode_seq enable row level security;
-- Ingen policies med vilje: tælleren røres kun af next_parcel_barcode
-- (security definer). Ingen klient skal kunne læse eller sætte den.
revoke all on public.parcel_barcode_seq from anon, authenticated;

create or replace function public.next_parcel_barcode(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v bigint;
  candidate text;
begin
  -- Klienten er utroværdig: virksomheden genverificeres her.
  if p_company_id is null
     or not (p_company_id = public.current_company_id() or public.is_platform_admin()) then
    raise exception 'Ingen adgang til denne virksomhed';
  end if;

  loop
    insert into public.parcel_barcode_seq as s (company_id, last_value)
    values (p_company_id, 1)
    on conflict (company_id) do update set last_value = s.last_value + 1
    returning s.last_value into v;

    candidate := 'OPERIA-' || lpad(v::text, 6, '0');

    -- Tælleren kan være bagud, hvis den samme kode én gang er tastet manuelt —
    -- så springes nummeret over i stedet for at give en dublet.
    exit when not exists (
      select 1 from public.parcels
      where company_id = p_company_id and barcode = candidate
    );
  end loop;

  return candidate;
end;
$$;

revoke all on function public.next_parcel_barcode(uuid) from public;
grant execute on function public.next_parcel_barcode(uuid) to authenticated;

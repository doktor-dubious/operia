-- Kategorifarver i bookingkalenderen: manageren vælger farven, i stedet for at
-- den udledes af oprettelsesrækkefølgen (hvor en sletning flyttede farven på
-- alle efterfølgende kategorier).
--
-- Farven gemmes som et INDEKS i en fast palette (--booking-category-N i
-- web/src/index.css), ikke som fri hex. Paletten har en forudberegnet
-- tekstkontrast pr. felt (--booking-category-N-fg, alle >= 4.5:1); en vilkårlig
-- hex fra en farvevælger ville bryde den garanti uden at nogen opdagede det.

alter table public.booking_categories
  add column color_index smallint
    check (color_index is null or (color_index >= 0 and color_index < 13));

comment on column public.booking_categories.color_index is
  'Plads i bookingpaletten (0-12) — svarer til --booking-category-(N+1) i web/src/index.css. '
  'NULL kun teoretisk: trigger''en tildeler en ledig plads ved insert.';

-- Frys det, brugerne ser i dag: farven var oprettelsesrækkefølgen modulo
-- paletstørrelsen, så samme udtryk giver et uændret kalenderbillede.
update public.booking_categories c
set color_index = s.idx
from (
  select
    id,
    ((row_number() over (partition by company_id order by created_at, id) - 1) % 13)::smallint as idx
  from public.booking_categories
) s
where s.id = c.id;

-- Nye kategorier får den laveste ledige plads, så de første 13 i en virksomhed
-- er indbyrdes forskellige uden at manageren skal tage stilling.
create or replace function public.booking_categories_assign_color()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.color_index is null then
    select coalesce(min(i), 0) into new.color_index
    from generate_series(0, 12) as i
    where not exists (
      select 1 from public.booking_categories c
      where c.company_id = new.company_id and c.color_index = i
    );
  end if;
  return new;
end;
$$;

create trigger booking_categories_color
  before insert on public.booking_categories
  for each row execute function public.booking_categories_assign_color();

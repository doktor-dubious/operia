-- Detaljefelter til placeringer (detaljepanelet i stamdata).
alter table public.storage_locations
  add column description text,
  add column notes text;

-- Idempotens-nøgle for håndterminalens modtagelser: terminalen genererer en
-- client_key pr. scannet pakke. Går svaret tabt EFTER serveren har committet
-- (timeout/afkodningsfejl), gemmer terminalen rækkerne i offline-køen og
-- indsender igen — det unikke indeks gør gensendingen til en dublet-fejl i
-- stedet for en ekstra pakke. Nullable: web-appen og eksisterende rækker har
-- ingen nøgle og deltager ikke i dedup'en.
alter table public.parcels
  add column client_key uuid;

create unique index parcels_client_key_key
  on public.parcels (company_id, client_key)
  where client_key is not null;

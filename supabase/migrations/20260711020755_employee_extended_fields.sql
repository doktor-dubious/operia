-- Udvidede medarbejder-/modtagerfelter fra prototypens scope: navnedele,
-- NFC-kort (bruges til udlevering via NFC/MIFARE, spec §handover) og rolle-
-- betegnelse (fritekst — RBAC ligger fortsat i user_roles).
alter table public.employees
  add column first_name text,
  add column last_name text,
  add column nfc_card_id text,
  add column role text;

-- Et NFC-kort identificerer én medarbejder i virksomheden.
create unique index employees_company_nfc_card_key
  on public.employees (company_id, nfc_card_id)
  where nfc_card_id is not null;

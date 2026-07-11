-- Operia-konfiguration: platform-niveau skabeloner (fx invitations-e-mail).
-- DCA-ejet, globalt (ikke tenant-data) — kun platform-admins kan læse/skrive.

create table public.platform_templates (
  key text primary key,           -- stabil nøgle, fx 'customer_invite'
  name text not null,             -- visningsnavn i vælgeren
  title text not null default '', -- emne/overskrift
  body text not null default '',  -- brødtekst (HTML eller ren tekst)
  updated_at timestamptz not null default now()
);

create trigger platform_templates_set_updated_at
  before update on public.platform_templates
  for each row execute function public.set_updated_at();

alter table public.platform_templates enable row level security;

-- Kun platform-admins (superbrugere) ser og redigerer skabelonerne.
create policy platform_templates_all on public.platform_templates
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant select, insert, update, delete on public.platform_templates to authenticated;

-- Seed: den ene skabelon vi har indtil videre.
insert into public.platform_templates (key, name, title, body) values
  (
    'customer_invite',
    'New Customer Invite',
    'Du er blevet inviteret til Operia',
    'Du er blevet inviteret til at oprette en konto i Operia. Klik på linket i e-mailen for at acceptere invitationen og vælge din adgangskode.'
  );

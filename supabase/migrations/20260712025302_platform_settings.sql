-- Platformens sprogindstillinger (Operia-konfiguration → Lokalisering):
-- hvilke sprog platformen udbyder, og hvilket der er systemstandard.
-- Singleton-tabel: id er altid true, så der højst kan findes én række.
create table public.platform_settings (
  id boolean primary key default true check (id),
  supported_languages text[] not null default '{da,en}',
  default_language text not null default 'da',
  updated_at timestamptz not null default now(),
  check (default_language = any (supported_languages))
);

create trigger platform_settings_set_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();

alter table public.platform_settings enable row level security;

-- Sproglisten er ikke hemmelig og skal kunne drive sprogvælgere for alle
-- brugere; kun platform-admins (DCA) kan ændre den. Ingen insert/delete-
-- politik — rækken seedes én gang her.
create policy platform_settings_select on public.platform_settings
  for select to authenticated using (true);

create policy platform_settings_update on public.platform_settings
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant select, update on public.platform_settings to authenticated;

insert into public.platform_settings (id) values (true);

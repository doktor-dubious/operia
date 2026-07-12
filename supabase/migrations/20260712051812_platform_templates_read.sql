-- Konfigurér → Skabeloner: virksomheder starter fra platformens standard-
-- skabeloner, så alle autentificerede brugere skal kunne læse dem (indholdet
-- er ikke hemmeligt). Skrivning er fortsat kun for platform-admins via
-- platform_templates_all.
create policy platform_templates_read on public.platform_templates
  for select to authenticated using (true);

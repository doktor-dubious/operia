-- Kundelogo + indkøbs-email på companies (fra prototypens scope).
--  - purchasing_email: standardmodtager for indkøbsordrer fra Lager-produktet;
--    kan tilsidesættes pr. ordre.
--  - logo_url: kundens logo — enten en ekstern URL eller en fil uploadet til
--    storage-bucket'en company-logos.

alter table public.companies
  add column purchasing_email text,
  add column logo_url text;

-- Offentlig bucket til kundelogoer: logoet skal kunne vises uden auth (fx på
-- login-/velkomstskærme), så læsning er offentlig. Kun platform-admins (DCA)
-- må skrive — kundelogoer administreres på Platform → Kunder.
insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', true)
on conflict (id) do nothing;

create policy company_logos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'company-logos' and public.is_platform_admin());

create policy company_logos_update on storage.objects
  for update to authenticated
  using (bucket_id = 'company-logos' and public.is_platform_admin())
  with check (bucket_id = 'company-logos' and public.is_platform_admin());

create policy company_logos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'company-logos' and public.is_platform_admin());

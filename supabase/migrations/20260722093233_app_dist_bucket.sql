-- App-distribution: offentlig bucket til håndterminal-APK'en (QR-kode-installation).
-- Læsning er offentlig (APK'en indeholder kun den offentlige anon key); kun
-- platform-admins kan uploade/erstatte filer. Stien holdes stabil, så den trykte
-- QR-kode peger på samme URL på tværs af versioner.

insert into storage.buckets (id, name, public)
values ('app-dist', 'app-dist', true)
on conflict (id) do nothing;

create policy app_dist_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'app-dist' and public.is_platform_admin());

create policy app_dist_update on storage.objects
  for update to authenticated
  using (bucket_id = 'app-dist' and public.is_platform_admin())
  with check (bucket_id = 'app-dist' and public.is_platform_admin());

create policy app_dist_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'app-dist' and public.is_platform_admin());

create policy app_dist_select on storage.objects
  for select to authenticated
  using (bucket_id = 'app-dist' and public.is_platform_admin());

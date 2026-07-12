-- Oprydning i company-logos kræver list() fra webappen, og storage-API'ets
-- list/select går gennem RLS (den offentlige adgang gælder kun de offentlige
-- objekt-URL'er). Platform-admins skal kunne liste en virksomheds logo-mappe
-- for at fjerne udskiftede/fjernede logoer — bucket'en er offentlig, så
-- forældede filer må ikke blive liggende tilgængelige (GDPR).
create policy company_logos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'company-logos' and public.is_platform_admin());

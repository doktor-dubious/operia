-- app-dist er en offentlig bucket (alle kan læse via den offentlige URL), men
-- select-policyen fra 20260722093233 begrænsede SDK-læsning (list/download) til
-- platform-admins — dvs. loggede brugere havde MINDRE læseadgang end anonyme.
-- Ret policyen, så select matcher bucketens offentlige design; skrivning er
-- fortsat forbeholdt platform-admins.
drop policy if exists app_dist_select on storage.objects;

create policy app_dist_select on storage.objects
  for select to authenticated
  using (bucket_id = 'app-dist');

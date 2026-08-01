-- Sletningsvej for aktiv-dokumentation (asset_documents + asset-photos) — GDPR.
--
-- Flow-noterne blev bevidst lagt i asset_documents og IKKE i den immutable
-- hændelseslog med begrundelsen "sletbare ved behov, GDPR" (20260801090200) —
-- men der fandtes ingen sletningsvej: UPDATE/DELETE var revoked for alle
-- klienter, og ingen RPC rørte tabellen. En fritekstnote med persondata
-- ("afhentet hos Jens Hansen, tlf …") kunne dermed aldrig renses in-app.
--
-- Samme model som pakkefilerne (20260720130200): managere kan fortsat IKKE
-- slette — dokumentationen er bevismateriale, og kunden må ikke kunne fjerne
-- beviser i en tvist. En berettiget sletteanmodning håndteres af platform-
-- admin (DCA), på linje med hård sletning af medarbejdere. UPDATE forbliver
-- revoked for alle: rensning er sletning, aldrig omskrivning.

create policy asset_documents_delete on public.asset_documents
  for delete to authenticated
  using (public.is_platform_admin());

grant delete on public.asset_documents to authenticated;

-- Fotoet i den private bucket skal kunne følge rækken ud.
create policy asset_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'asset-photos' and public.is_platform_admin());

-- Sporbarhed: sletningen skrives i aktivets immutable historik (SECURITY
-- DEFINER: uden om asset_events' klient-revoke) og spejles derfra til
-- audit_log ('asset.document_deleted' → niveau 'warning' via '%.deleted').
-- Ingen persondata i detail — indholdet er netop dét der slettes.
create or replace function public.log_asset_document_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.asset_events
    (asset_id, company_id, event_type, actor_user_id, detail)
  values
    (old.asset_id, old.company_id, 'document_deleted', auth.uid(),
     jsonb_build_object(
       'document_id', old.id,
       'had_note', coalesce(old.note, '') <> '',
       'had_photo', old.storage_path is not null
     ));
  return old;
end;
$$;

create trigger asset_documents_log_delete
  after delete on public.asset_documents
  for each row execute function public.log_asset_document_deleted();

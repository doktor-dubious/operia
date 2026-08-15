-- Sletningsvej for pakkedokumentation (parcel_documents) — GDPR.
--
-- Fundet under gennemgangen af fritekstfelter (docs/gdpr/free-text-fields.md):
-- aktiv-siden fik en sletningsvej i 20260801180000, men pakke-siden blev
-- aldrig givet den samme. parcel_documents har i dag KUN insert- og
-- select-politikker, så:
--
--   * fotoet i 'parcel-photos' kan slettes af en platform-admin
--     (20260720130200), men
--   * fritekstnoten ved siden af kan ingen fjerne — heller ikke DCA.
--
-- Rækken forsvinder først, når hele pakken gør (FK'en er cascade + kategorien
-- 'parcels' i opbevaringspolitikken). En berettiget sletteanmodning, der
-- rammer netop én note, kunne altså ikke imødekommes. Det er en forglemmelse,
-- ikke en beslutning — her rettes den efter samme model som aktiverne.
--
-- Managere kan fortsat IKKE slette: dokumentationen er bevismateriale, og
-- kunden må ikke kunne fjerne beviser i en tvist. UPDATE forbliver revoked
-- for alle — rensning er sletning, aldrig omskrivning.

create policy parcel_documents_delete on public.parcel_documents
  for delete to authenticated
  using (public.is_platform_admin());

grant delete on public.parcel_documents to authenticated;

-- Sporbarhed: sletningen skrives i pakkens immutable historik (SECURITY
-- DEFINER, uden om parcel_events' klient-revoke) og spejles derfra til
-- audit_log som 'parcel.document_deleted'. Ingen persondata i detail —
-- indholdet er netop dét, der slettes.
create or replace function public.log_parcel_document_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.parcel_events
    (parcel_id, company_id, event_type, actor_user_id, detail)
  values
    (old.parcel_id, old.company_id, 'document_deleted', auth.uid(),
     jsonb_build_object(
       'document_id', old.id,
       'had_note', coalesce(old.note, '') <> '',
       'had_file', old.storage_path is not null
     ));
  return old;
end;
$$;

create trigger parcel_documents_log_delete
  after delete on public.parcel_documents
  for each row execute function public.log_parcel_document_deleted();

-- ---------------------------------------------------------------------------
-- Udbyder-fejltekster: ryd hvad der måtte ligge fra før maskeringen.
--
-- parcel_notifications.error / asset_loan_notifications.error / log_drains.
-- last_error gemmer svaret fra Resend, GatewayAPI eller kundens eget
-- logsystem, og et afvist forsøg citerer rutinemæssigt adressen der fejlede.
-- Fra nu af maskeres teksten ved lagringen (sanitizeProviderError i
-- supabase/functions/_shared/notify.ts). Rækker skrevet FØR det, kan indeholde
-- en adresse i klar tekst — de nulstilles her frem for at blive forsøgt
-- renset, fordi en gammel fejltekst ikke har nogen driftsværdi.
--
-- Bemærk: begge tabeller er almindelige (ikke append-only), så en UPDATE er
-- tilladt; audit_log røres ikke.
-- ---------------------------------------------------------------------------
update public.parcel_notifications
   set error = null
 where error is not null
   and error ~ '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[0-9]{8,}';

update public.asset_loan_notifications
   set error = null
 where error is not null
   and error ~ '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[0-9]{8,}';

update public.log_drains
   set last_error = null
 where last_error is not null
   and last_error ~ '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|[0-9]{8,}';

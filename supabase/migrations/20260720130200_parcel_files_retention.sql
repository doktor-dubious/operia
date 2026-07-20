-- Sletningsvej for tilstandsfotos, pakkedokumenter og underskrifter.
--
-- Indtil nu havde hverken 'parcel-photos' eller 'signatures' en DELETE-politik
-- på storage.objects: INGEN kunne slette en fil — heller ikke ved en berettiget
-- sletteanmodning — og filerne blev efterladt som forældreløse når en pakke
-- eller en hel virksomhed blev slettet. Underskrifter er billeder af en persons
-- håndskrift og dermed en stærk identifikator.
--
-- Der åbnes bevidst IKKE for at managere kan slette: fotos og underskrifter er
-- kædedokumentation (samme begrundelse som parcel_events er uforanderlig), og
-- kunden må ikke kunne fjerne beviser i en tvist. Sletning sker derfor på to
-- kontrollerede måder:
--   1. Platform-admin (DCA) kan slette enkeltfiler — vejen til en konkret
--      sletteanmodning, på linje med at hård sletning af medarbejdere også er
--      platform-admin-only.
--   2. Det daglige oprydningsjob (parcel-files-cleanup) fjerner filer der er
--      ældre end opbevaringsvinduet, samt forældreløse filer hvis pakke ikke
--      længere findes.

-- ---------------------------------------------------------------------------
-- 1) Opbevaringsvindue (null = behold for altid, som de øvrige vinduer)
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  add column parcel_files_retention_days integer check (parcel_files_retention_days > 0);

comment on column public.platform_settings.parcel_files_retention_days is
  'Dage før tilstandsfotos/dokumenter/underskrifter slettes. NULL = behold for altid.';

create or replace function public.audit_platform_file_retention()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parcel_files_retention_days is distinct from old.parcel_files_retention_days then
    perform public.record_audit(null, 'retention.changed', 'platform_settings', 'platform', null,
      jsonb_build_object('parcel_files_retention_days', new.parcel_files_retention_days));
  end if;
  return new;
end;
$$;

create trigger platform_settings_file_retention_audit
  after update on public.platform_settings
  for each row execute function public.audit_platform_file_retention();

-- ---------------------------------------------------------------------------
-- 2) DELETE-politikker (kun platform-admins)
-- ---------------------------------------------------------------------------
create policy parcel_photos_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'parcel-photos' and public.is_platform_admin());

create policy signatures_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'signatures' and public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3) Dagligt oprydningsjob
-- ---------------------------------------------------------------------------
-- Kører også når vinduet er NULL: den forældreløse-oprydning er uafhængig af
-- opbevaringspolitikken (en fil uden pakke har intet formål at tjene).
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule('operia-parcel-files-cleanup', '25 3 * * *', $job$
do $inner$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url := 'https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/parcel-files-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb
  );
end
$inner$;
$job$);

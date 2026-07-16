-- Hærdning af den automatiske ingest (SFTP + e-mail) efter kodegennemgang:
--   1) message_id på inbound_files: Postmark leverer mindst-én-gang, så samme
--      mail kan komme to gange — det unikke indeks gør dublet-leveringer til
--      no-ops i stedet for dobbelt-imports.
--   2) import_locks + try/release-RPC'er: én import ad gangen pr. virksomhed.
--      To samtidige kørsler (SFTP + e-mail, eller en gentagen levering) ville
--      ellers race deres read-then-write-diff og kollidere på unik-indekset.
--   3) pg_cron-job der dagligt kalder imports-cleanup (hængende inbound_files
--      → failed; objekter i imports-bucket'en ryddes efter retention).

-- --- 1) Dublet-værn for e-mail-leveringer -----------------------------------
alter table public.inbound_files
  add column message_id text;

create unique index inbound_files_message_id_key
  on public.inbound_files (source, message_id)
  where message_id is not null;

-- --- 2) Pr.-virksomhed importlås ---------------------------------------------
-- Række = låst. Forældede låse (>15 min — langt over en edge-funktions levetid)
-- ryddes af try_import_lock selv, så en crashet runner aldrig låser permanent.
create table public.import_locks (
  company_id uuid primary key references public.companies (id) on delete cascade,
  locked_at timestamptz not null default now()
);

-- Ingen policies: kun service-role (edge-funktionerne) rører tabellen.
alter table public.import_locks enable row level security;

create or replace function public.try_import_lock(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.import_locks
  where company_id = p_company_id
    and locked_at < now() - interval '15 minutes';
  begin
    insert into public.import_locks (company_id) values (p_company_id);
    return true;
  exception when unique_violation then
    return false;
  end;
end;
$$;

create or replace function public.release_import_lock(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.import_locks where company_id = p_company_id;
end;
$$;

revoke execute on function public.try_import_lock(uuid) from public, anon, authenticated;
revoke execute on function public.release_import_lock(uuid) from public, anon, authenticated;
grant execute on function public.try_import_lock(uuid) to service_role;
grant execute on function public.release_import_lock(uuid) to service_role;

-- --- 3) Dagligt vedligehold (samme Vault-mønster som log-drain-dispatch) ----
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule('operia-imports-cleanup', '20 3 * * *', $job$
do $inner$
begin
  if (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key') is not null then
    perform net.http_post(
      url := 'https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/imports-cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := '{}'::jsonb
    );
  end if;
end
$inner$;
$job$);

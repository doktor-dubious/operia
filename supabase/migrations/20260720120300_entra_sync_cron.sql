-- Planlagt AD-synkronisering. Ét cron-job hvert 15. minut kigger på hvilke
-- virksomheder der er forfaldne efter deres eget interval (eller platformens,
-- hvis de ikke har valgt et) og kalder entra-sync for netop dem. Samme mønster
-- som operia-asset-reminders: service-role-nøgle fra Vault, selv-tavst hvis
-- hovedafbryderen er slået fra eller hemmeligheden mangler.
--
-- Virksomheder uden gennemført tørkørsel springes over — den første rigtige
-- synk skal godkendes af et menneske, ellers kan en forkert gruppe eller tenant
-- masse-deaktivere et direktorie uden at nogen har set tallene.

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule('operia-entra-sync', '*/15 * * * *', $job$
do $inner$
declare
  v_key text;
  v_default_interval int;
  r record;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return; end if;

  select entra_sync_interval_minutes into v_default_interval
    from public.platform_settings
   where entra_enabled
   limit 1;
  if v_default_interval is null then return; end if;

  for r in
    select c.company_id,
           coalesce(c.sync_interval_minutes, v_default_interval) as mins,
           c.last_sync_at
      from public.company_entra_config c
     where c.enabled
       and c.tenant_id is not null
       and c.client_id is not null
       and c.client_secret_set
       and (c.dry_run_at is not null or c.first_sync_at is not null)
  loop
    if r.last_sync_at is null
       or r.last_sync_at <= now() - make_interval(mins => r.mins) then
      perform net.http_post(
        url := 'https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/entra-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object('companyId', r.company_id, 'mode', 'apply')
      );
    end if;
  end loop;
end
$inner$;
$job$);

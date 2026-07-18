-- Planlæg pakke-notifikationer: pg_cron kalder dispatch-parcel-notifications
-- hvert 5. minut. Kaldet autoriseres med service-role-nøglen fra Vault (samme
-- 'service_role_key'-hemmelighed som log-drain-dispatch bruger — opret én gang:
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
-- ). Selv-tavst: funktionen kaldes kun når hovedafbryderen er slået til OG
-- Vault-hemmeligheden findes — så intet sker, før feature'en bevidst aktiveres
-- (funktionen deployet + hemmelighed oprettet + parcel_notifications_enabled=true).

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule('operia-parcel-notifications', '*/5 * * * *', $job$
do $inner$
begin
  if (select parcel_notifications_enabled from public.platform_settings limit 1)
     and (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key') is not null
  then
    perform net.http_post(
      url := 'https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/dispatch-parcel-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization',
          'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := jsonb_build_object('mode', 'dispatch')
    );
  end if;
end
$inner$;
$job$);

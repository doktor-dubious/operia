-- Planlæg aktiv-udlåns-påmindelser: pg_cron kalder dispatch-asset-reminders hvert
-- 5. minut. Samme mønster som operia-parcel-notifications: service-role-nøgle fra
-- Vault ('service_role_key'), selv-tavst — kalder kun funktionen når
-- asset_notifications_enabled er slået til OG Vault-hemmeligheden findes.

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule('operia-asset-reminders', '*/5 * * * *', $job$
do $inner$
begin
  if (select asset_notifications_enabled from public.platform_settings limit 1)
     and (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key') is not null
  then
    perform net.http_post(
      url := 'https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/dispatch-asset-reminders',
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

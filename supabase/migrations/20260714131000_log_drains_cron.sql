-- Planlæg leveringen af log-drains: pg_cron kalder Edge Function
-- log-drain-dispatch hvert minut. Kaldet autoriseres med service-role-nøglen,
-- der IKKE ligger i git — den hentes fra Supabase Vault (opret én gang:
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
-- ). Jobbet er selv-tavst: det kalder kun funktionen når der findes mindst ét
-- aktivt dræn OG Vault-hemmeligheden er sat — så intet sker før feature'en er
-- aktiveret (funktionen deployet + hemmelighed oprettet).

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule('operia-log-drain-dispatch', '* * * * *', $job$
do $inner$
begin
  if exists (select 1 from public.log_drains where enabled)
     and (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key') is not null
  then
    perform net.http_post(
      url := 'https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/log-drain-dispatch',
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

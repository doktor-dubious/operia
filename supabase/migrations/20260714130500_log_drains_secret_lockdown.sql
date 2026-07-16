-- Gør log_drains.secret skrive-kun. Supabases standard-privilegier giver
-- automatisk tabel-bred SELECT til anon/authenticated ved oprettelse, hvilket
-- dækker secret-kolonnen. Vi tilbagekalder den tabel-brede SELECT og gengiver
-- kun de ikke-følsomme kolonner — så klienten kan sætte/erstatte en hemmelighed,
-- men aldrig læse den tilbage (dispatcheren læser den via service-role).
revoke select on public.log_drains from anon, authenticated;

grant select (
  id, company_id, name, destination, endpoint, config, enabled, secret_set,
  last_delivered_id, last_run_at, last_status, last_error, created_at, updated_at
) on public.log_drains to authenticated;

-- Impersonering (impersonate-user-funktionen) indløser et magic-link-token
-- server-side for at få målets session. GoTrue sætter email_confirmed_at og
-- last_sign_in_at ved indløsningen — men impersonering er hverken brugerens
-- egen invitations-accept eller eget login, så funktionen genskaber de forrige
-- værdier bagefter via denne RPC. Uden den ville Verificeret/Seneste login-
-- kolonnerne vise falske signaler (fx "invitation accepteret" for en bruger,
-- der aldrig har åbnet den).
--
-- Kun service-role må kalde den: den skriver direkte i auth.users.
create or replace function public.impersonation_restore_auth_state(
  p_user_id uuid,
  p_email_confirmed_at timestamptz,
  p_last_sign_in_at timestamptz
) returns void
language sql
security definer
set search_path = ''
as $$
  update auth.users
  set email_confirmed_at = p_email_confirmed_at,
      last_sign_in_at = p_last_sign_in_at
  where id = p_user_id;
$$;

revoke all on function public.impersonation_restore_auth_state(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.impersonation_restore_auth_state(uuid, timestamptz, timestamptz)
  to service_role;

-- Platform-admin-konti til Operia → Brugere. Siden fletter DCA's super-tenant-
-- konti (platform_admins) ind i brugerlisten, men de har typisk ingen app_users-
-- række (ingen virksomhedsmedlemskab) og deres e-mail ligger i auth.users, som
-- klienten ikke kan læse. Vi eksponerer derfor navn/e-mail/verifikation via en
-- SECURITY DEFINER-RPC, kun for platform-admins (siden er platform-admin-only).
-- Sidestykke til admin_user_verification, men joinet på platform_admins i stedet
-- for app_users, så også konti uden app_users-række kommer med.
create or replace function public.admin_platform_admins()
returns table (user_id uuid, email text, email_confirmed_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, u.email, u.email_confirmed_at, p.created_at
  from public.platform_admins p
  join auth.users u on u.id = p.user_id
  where public.is_platform_admin();
$$;

revoke execute on function public.admin_platform_admins() from public, anon;
grant execute on function public.admin_platform_admins() to authenticated;

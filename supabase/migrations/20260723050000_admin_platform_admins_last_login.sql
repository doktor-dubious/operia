-- Tilføj seneste login (auth.users.last_sign_in_at) til platform-admin-RPC'en,
-- så Operia → Brugere kan vise en "seneste login"-kolonne også for super-tenant-
-- konti uden app_users-række. Returtypen ændres, så funktionen droppes og
-- genskabes (create or replace kan ikke ændre OUT-parametre).
drop function if exists public.admin_platform_admins();

create function public.admin_platform_admins()
returns table (
  user_id uuid,
  email text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, u.email, u.email_confirmed_at, u.last_sign_in_at, p.created_at
  from public.platform_admins p
  join auth.users u on u.id = p.user_id
  where public.is_platform_admin();
$$;

revoke execute on function public.admin_platform_admins() from public, anon;
grant execute on function public.admin_platform_admins() to authenticated;

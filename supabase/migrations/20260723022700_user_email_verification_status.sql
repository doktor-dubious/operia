-- Verifikationsstatus pr. bruger til Operia → Brugere: har brugeren accepteret
-- sin invitation (sat adgangskode via /welcome)? Signalet er
-- auth.users.email_confirmed_at — invite-flowet (generateLink type 'invite')
-- efterlader den NULL indtil linket indløses; direkte oprettede brugere
-- (email_confirm: true) er bekræftet fra start. auth-skemaet kan ikke læses af
-- klienten, så vi eksponerer det via en SECURITY DEFINER-RPC, kun for
-- platform-admins (siden er platform-admin-only).
create or replace function public.admin_user_verification()
returns table (user_id uuid, email_confirmed_at timestamptz, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email_confirmed_at, u.last_sign_in_at
  from auth.users u
  join public.app_users au on au.user_id = u.id
  where public.is_platform_admin();
$$;

revoke execute on function public.admin_user_verification() from public, anon;
grant execute on function public.admin_user_verification() to authenticated;

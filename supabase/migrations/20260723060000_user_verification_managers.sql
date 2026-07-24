-- Udvid verifikations-RPC'en, så managers også ser verifikations-/login-status
-- for deres EGEN virksomheds brugere (Konfiguration → Brugere) — ikke kun
-- platform-admins (Operia → Brugere). Platform-admins ser fortsat alt; managers
-- begrænses til current_company_id(); øvrige roller får ingen rækker.
--
-- Sikkert: en manager kan i forvejen se sine kollegers app_users-rækker (RLS),
-- og her tilføjes kun email_confirmed_at/last_sign_in_at for netop det sæt.
-- Samme signatur som før, så create or replace er nok (ingen drop).
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
  where public.is_platform_admin()
     or (au.company_id = public.current_company_id() and public.has_role('manager'));
$$;

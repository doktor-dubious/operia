-- Superuser-administration fra web'en: gør det muligt for en platform-admin at
-- give/fjerne platform-admin (superuser) på en eksisterende bruger via Operia →
-- Brugere. Tidligere kunne listen kun ændres direkte i databasen.
--
-- To lag:
--   1. En audit-trigger på platform_admins, så ENHVER ændring (RPC, tabel-API
--      eller manuel SQL) havner i den uforanderlige NIS2-log — spejler
--      audit_app_users. company_id er null (platform-niveau), så posterne kun
--      er synlige for platform-admins (audit_log_select).
--   2. En SECURITY DEFINER-RPC der genverificerer at kalderen selv er
--      platform-admin (ud over RLS), forbyder selv-fjernelse (så man ikke låser
--      sig selv ude) og kræver at målet er en rigtig auth-bruger.
--
-- PII: kun user_id (uuid) logges — ingen e-mail/navn i audit_log (GDPR).

-- ---------------------------------------------------------------------------
-- Audit-trigger
-- ---------------------------------------------------------------------------
create or replace function public.audit_platform_admins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(null, 'user.platform_admin_granted', 'platform_admin',
      new.user_id::text, null);
    return new;
  else
    perform public.record_audit(null, 'user.platform_admin_revoked', 'platform_admin',
      old.user_id::text, null);
    return old;
  end if;
end;
$$;

create trigger audit_platform_admins_trg after insert or delete on public.platform_admins
  for each row execute function public.audit_platform_admins();

-- ---------------------------------------------------------------------------
-- Grant/revoke-RPC
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_platform_admin(
  p_target uuid,
  p_make_admin boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Genverificér server-side: kun eksisterende platform-admins må ændre listen.
  if not public.is_platform_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_target is null then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  -- Ingen selv-fjernelse: undgå at den sidste/aktive admin låser sig selv ude.
  if not p_make_admin and p_target = (select auth.uid()) then
    raise exception 'cannot_revoke_self' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users where id = p_target) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  if p_make_admin then
    insert into public.platform_admins (user_id) values (p_target)
    on conflict (user_id) do nothing;
  else
    delete from public.platform_admins where user_id = p_target;
  end if;
end;
$$;

revoke execute on function public.admin_set_platform_admin(uuid, boolean) from public, anon;
grant execute on function public.admin_set_platform_admin(uuid, boolean) to authenticated;

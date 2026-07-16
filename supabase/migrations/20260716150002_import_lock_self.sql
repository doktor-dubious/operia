-- Den manuelle web-import (Anvend) skal serialisere med den automatiske
-- SFTP/e-mail-runner: begge laver read-then-write-diffs, og uden lås kan de
-- interleave (dublet-nøgler midt i anvend / forkerte deaktiveringer).
-- try_import_lock/release_import_lock er service-role-only; her får
-- authenticated company-scopede wrappers, der genverificerer at kalderen er
-- manager (eller platform-admin) for netop den virksomhed.
create or replace function public.try_import_lock_self(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_company_id is null
     or not (p_company_id = public.current_company_id() or public.is_platform_admin())
     or not (public.has_role('manager') or public.is_platform_admin()) then
    raise exception 'not allowed';
  end if;
  return public.try_import_lock(p_company_id);
end;
$$;

create or replace function public.release_import_lock_self(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_company_id is null
     or not (p_company_id = public.current_company_id() or public.is_platform_admin())
     or not (public.has_role('manager') or public.is_platform_admin()) then
    raise exception 'not allowed';
  end if;
  perform public.release_import_lock(p_company_id);
end;
$$;

revoke execute on function public.try_import_lock_self(uuid) from public, anon;
revoke execute on function public.release_import_lock_self(uuid) from public, anon;
grant execute on function public.try_import_lock_self(uuid) to authenticated;
grant execute on function public.release_import_lock_self(uuid) to authenticated;

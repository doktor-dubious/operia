-- SFTP-adgangskoder må ikke ligge i klartekst i databasen (NIS2). Gem en
-- bcrypt-hash i stedet: klienten sender klarteksten til denne SECURITY DEFINER-
-- RPC, som hasher server-side. Klarteksten persisteres aldrig; klienten læser
-- kun det genererede 'sftp_password_set'. SFTPGo kan verificere bcrypt-hashen
-- direkte, så gateway-provisionering forbliver muligt.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_company_sftp_password(p_company_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_password is null or btrim(p_password) = '' then
    return; -- blank = behold nuværende
  end if;
  insert into public.company_data_transfer_secret (company_id, sftp_password)
  values (p_company_id, crypt(p_password, gen_salt('bf')))
  on conflict (company_id) do update set sftp_password = excluded.sftp_password;
end;
$$;

revoke execute on function public.set_company_sftp_password(uuid, text) from public, anon;
grant execute on function public.set_company_sftp_password(uuid, text) to authenticated;

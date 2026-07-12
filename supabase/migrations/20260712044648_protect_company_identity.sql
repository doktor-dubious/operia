-- Navn + CVR-nr. er virksomhedens identitet og må kun ændres af platform-
-- admins (DCA). RLS kan ikke skelne kolonner, og platform-admins deler
-- database-rollen authenticated med managers, så kolonne-grants rækker ikke —
-- derfor en trigger.
create or replace function public.protect_company_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.name is distinct from old.name
      or new.registration_no is distinct from old.registration_no)
    -- Service-rollen (Edge Functions) har ingen auth.uid() og er undtaget;
    -- anon når aldrig hertil (ingen update-politik for anon).
    and auth.uid() is not null
    and not public.is_platform_admin() then
    raise exception 'Kun platform-admins kan ændre virksomhedens navn og CVR-nr.';
  end if;
  return new;
end;
$$;

create trigger companies_protect_identity
  before update on public.companies
  for each row execute function public.protect_company_identity();

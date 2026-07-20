-- GDPR-hærdning af anonymiseringen (opfølgning på gennemgangen 2026-07-20).
--
-- Tre problemer rettes her:
--   1. anonymize_employee lod `role` (fritekst-stillingsbetegnelse) og `user_id`
--      (link til auth.users, som holder e-mailadressen) stå tilbage.
--   2. audit_employees skrev medarbejderens fulde navn i audit_log ved
--      deaktivering og sletning. audit_log er UPDATE/DELETE-spærret, så navnet
--      kunne aldrig fjernes igen — heller ikke ved en sletteanmodning. Værst
--      ved AD-fratrædelse, hvor navnet allerede er EX-markeret og dermed også
--      røber at personen er fratrådt.
--   3. Samme mønster på udlån: asset.lent gemte lånerens navn i detail, og
--      asset.loan_updated gemte det i summary.
--
-- Princippet er det samme som den eksisterende 'employee.anonymized'-gren
-- allerede fulgte: referér til medarbejder-nr./id, aldrig til persondataen.
-- Revisionssporet bevares (hvem gjorde hvad hvornår på hvilken række) — kun
-- selve persondataen udelades.

-- ---------------------------------------------------------------------------
-- 1) anonymize_employee: ryd også role og user_id
-- ---------------------------------------------------------------------------
-- Returtypen ændres (void → boolean), så funktionen må droppes først. De
-- kaldende funktioner bruger `perform`, som binder ved kørsel, og påvirkes ikke.
drop function if exists public.anonymize_employee(uuid, text);

create or replace function public.anonymize_employee(
  p_employee_id uuid,
  p_label text default 'Anonymiseret medarbejder'
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_had_login boolean;
begin
  select company_id, user_id is not null into v_company, v_had_login
    from public.employees where id = p_employee_id;
  if v_company is null then
    raise exception 'employee_not_found';
  end if;
  -- auth.uid() er null når synkroniseringen kalder med service-role.
  if auth.uid() is not null
     and not public.is_platform_admin()
     and not (v_company = public.current_company_id() and public.has_role('manager')) then
    raise exception 'not_authorized';
  end if;

  update public.employees
     set full_name = p_label,
         first_name = null,
         last_name = null,
         initials = null,
         email = null,
         phone = null,
         nfc_card_id = null,
         employee_no = null,
         role = null,
         -- Koblingen til personen brydes: rækken må aldrig kunne matches til
         -- en Entra-bruger eller en loginkonto igen.
         external_id = null,
         user_id = null,
         retired_at = null,
         is_active = false,
         anonymized_at = now()
   where id = p_employee_id
     and anonymized_at is null;

  -- Sandt = medarbejderen HAVDE en loginkonto. Selve kontoen (app_users +
  -- auth.users, som også indeholder navn/e-mail) ligger uden for denne tabel og
  -- skal fjernes separat under Brugere — kaldere bør sige det til brugeren.
  return coalesce(v_had_login, false);
end;
$$;

revoke execute on function public.anonymize_employee(uuid, text) from public, anon;
grant execute on function public.anonymize_employee(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) audit_employees: ingen navne i revisionsloggen
-- ---------------------------------------------------------------------------
create or replace function public.audit_employees()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.record_audit(old.company_id, 'employee.deleted', 'employee', old.id::text,
      coalesce(old.employee_no, old.id::text));
    return old;
  elsif tg_op = 'UPDATE' then
    if new.anonymized_at is not null and old.anonymized_at is null then
      perform public.record_audit(new.company_id, 'employee.anonymized', 'employee', new.id::text,
        coalesce(old.employee_no, new.id::text));
    elsif old.is_active and not new.is_active then
      -- Tidligere blev new.full_name logget her. Ved AD-fratrædelse er det
      -- 'EX-<navn>', og rækken kan aldrig slettes igen.
      perform public.record_audit(new.company_id, 'employee.deactivated', 'employee', new.id::text,
        coalesce(new.employee_no, new.id::text));
    end if;
    return new;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Udlån: lånerens navn ud af revisionsloggen
-- ---------------------------------------------------------------------------
-- Kun record_audit-kaldet ændres; resten er ordret som i
-- 20260717200000_asset_status_loan_guard.sql.
create or replace function public.lend_asset(
  p_asset_id uuid,
  p_to_name text,
  p_to_address text default null,
  p_to_email text default null,
  p_to_phone text default null,
  p_ttl_hours integer default null,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_asset public.assets;
  v_email text := nullif(btrim(p_to_email), '');
  v_phone text := nullif(btrim(p_to_phone), '');
  v_expires timestamptz;
  v_loan_id uuid;
begin
  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset_not_found' using errcode = 'P0002';
  end if;
  if not public.can_write_assets(v_asset.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not v_asset.is_active then
    raise exception 'asset_inactive' using errcode = 'P0001';
  end if;
  if v_asset.status <> 'in_stock' then
    raise exception 'asset_not_in_stock' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_to_name), '') is null then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'contact_required' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'bad_email' using errcode = 'P0001';
  end if;
  if p_ttl_hours is not null and p_ttl_hours <= 0 then
    raise exception 'bad_ttl' using errcode = 'P0001';
  end if;

  v_expires := case
    when p_ttl_hours is null then null
    else now() + make_interval(hours => p_ttl_hours)
  end;

  insert into public.asset_loans (
    company_id, asset_id, to_name, to_address, to_email, to_phone, note, expires_at, lent_by
  ) values (
    v_asset.company_id, v_asset.id, btrim(p_to_name),
    nullif(btrim(p_to_address), ''), v_email, v_phone, nullif(btrim(p_note), ''),
    v_expires, auth.uid()
  ) returning id into v_loan_id;

  perform set_config('operia.asset_loan_rpc', '1', true);
  update public.assets set status = 'on_loan' where id = v_asset.id;

  -- to_name udelades bevidst: lånet kan slås op på loan_id, og navnet skal
  -- kunne anonymiseres når udlånet lukkes.
  perform public.record_audit(
    v_asset.company_id, 'asset.lent', 'asset', v_asset.id::text,
    coalesce(v_asset.name, v_asset.asset_tag),
    jsonb_build_object('loan_id', v_loan_id, 'expires_at', v_expires)
  );
  return v_loan_id;
end;
$$;

create or replace function public.update_asset_loan(
  p_loan_id uuid,
  p_to_name text,
  p_to_address text default null,
  p_to_email text default null,
  p_to_phone text default null,
  p_note text default null,
  p_expires_at timestamptz default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_old_email text;
  v_new_email text := nullif(btrim(p_to_email), '');
begin
  select company_id, to_email into v_company, v_old_email
    from public.asset_loans
    where id = p_loan_id and returned_at is null;
  if not found then
    raise exception 'loan_not_found' using errcode = 'P0002';
  end if;
  if not public.can_write_assets(v_company) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if nullif(btrim(p_to_name), '') is null then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if v_new_email is null and nullif(btrim(p_to_phone), '') is null then
    raise exception 'contact_required' using errcode = 'P0001';
  end if;

  update public.asset_loans set
    to_name    = btrim(p_to_name),
    to_address = nullif(btrim(p_to_address), ''),
    to_email   = v_new_email,
    to_phone   = nullif(btrim(p_to_phone), ''),
    note       = nullif(btrim(p_note), ''),
    expires_at = p_expires_at,
    bounced_at    = case when v_new_email is distinct from v_old_email then null else bounced_at end,
    bounce_reason = case when v_new_email is distinct from v_old_email then null else bounce_reason end
  where id = p_loan_id;

  -- Summary var tidligere lånerens navn; loan_id ligger allerede i entity_id.
  perform public.record_audit(
    v_company, 'asset.loan_updated', 'asset_loan', p_loan_id::text, null
  );
end;
$$;

-- Note på udlånet (fritekst fra «Lån ud»-dialogen), og let e-mailvalidering.
--
-- Bemærk droppet nedenfor: lend_asset får en ny parameter, og «create or
-- replace» ville derfor lave en NY overload ved siden af den gamle 6-argument-
-- version — hvorefter et kald med 6 argumenter er tvetydigt og fejler. Den
-- gamle signatur skal væk først.

alter table public.asset_loans add column note text;

drop function if exists public.lend_asset(uuid, text, text, text, text, integer);

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
  -- Samme løse form som klienten (isValidEmail i web/src/lib/validation.ts):
  -- fang tastefejl, afgør ikke om adressen findes. Al skrivning går gennem
  -- denne funktion (asset_loans har ingen skrivepolitik), så her er stedet.
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

  update public.assets set status = 'on_loan' where id = v_asset.id;

  perform public.record_audit(
    v_asset.company_id, 'asset.lent', 'asset', v_asset.id::text,
    coalesce(v_asset.name, v_asset.asset_tag),
    jsonb_build_object('loan_id', v_loan_id, 'to_name', btrim(p_to_name), 'expires_at', v_expires)
  );
  return v_loan_id;
end;
$$;

revoke execute on function public.lend_asset(uuid, text, text, text, text, integer, text)
  from public, anon;
grant execute on function public.lend_asset(uuid, text, text, text, text, integer, text)
  to authenticated;

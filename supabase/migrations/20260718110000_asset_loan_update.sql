-- Rediger et åbent aktiv-udlån (Låner-fanen på Aktiver-siden).
--
-- asset_loans har BEVIDST ingen skrivepolitik (se 20260717090000): browseren er
-- utroværdig, og status + udlånsrække skal følges ad. Redigering af lånerens
-- kontaktoplysninger og udløb ændrer ikke selve status-maskinen, men skal stadig
-- gennem en SECURITY DEFINER-funktion, der gentjekker rettighederne server-side —
-- samme grænse som lend_asset/return_asset (can_write_assets).
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
begin
  -- Kun åbne udlån kan redigeres — et returneret lån er historik.
  select company_id into v_company
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
  -- «En af Email eller SMS er påkrævet» — samme kontrakt som lend_asset og
  -- tabellens check-constraint.
  if nullif(btrim(p_to_email), '') is null and nullif(btrim(p_to_phone), '') is null then
    raise exception 'contact_required' using errcode = 'P0001';
  end if;

  update public.asset_loans set
    to_name    = btrim(p_to_name),
    to_address = nullif(btrim(p_to_address), ''),
    to_email   = nullif(btrim(p_to_email), ''),
    to_phone   = nullif(btrim(p_to_phone), ''),
    note       = nullif(btrim(p_note), ''),
    expires_at = p_expires_at
  where id = p_loan_id;

  perform public.record_audit(
    v_company, 'asset.loan_updated', 'asset_loan', p_loan_id::text, btrim(p_to_name)
  );
end;
$$;

revoke execute on function public.update_asset_loan(uuid, text, text, text, text, text, timestamptz)
  from public, anon;
grant execute on function public.update_asset_loan(uuid, text, text, text, text, text, timestamptz)
  to authenticated;

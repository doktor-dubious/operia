-- Bounce-markering pr. udlån, så Låner-fanen kan vise en rød note under en
-- e-mail der ikke kunne leveres. Sættes af resend-webhook (service-role) når et
-- 'email.bounced' matcher lånets aktuelle to_email; ryddes automatisk når
-- adressen ændres (markeringen gjaldt den gamle adresse).
alter table public.asset_loans
  add column bounced_at timestamptz,
  add column bounce_reason text;

-- update_asset_loan udvides: rydder bounce-markeringen når to_email ændres.
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
    -- Ny adresse ⇒ den gamle bounce gælder ikke længere.
    bounced_at    = case when v_new_email is distinct from v_old_email then null else bounced_at end,
    bounce_reason = case when v_new_email is distinct from v_old_email then null else bounce_reason end
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

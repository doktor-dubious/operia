-- Supabase's default privileges gav authenticated/anon fuld adgang til den
-- nye tabel, så kolonne-grants'ene fra forrige migration var kun additive —
-- api_key kunne stadig læses. Fjern alt og giv kun det tilsigtede tilbage:
-- alt undtagen api_key kan læses; api_key kan kun skrives.
revoke all on public.carrier_agreements from authenticated, anon;

grant select (id, agreement_type, provider, name, api_user, account_no, has_key, is_active, created_at, updated_at)
  on public.carrier_agreements to authenticated;
grant insert (agreement_type, provider, name, api_user, account_no, api_key, is_active)
  on public.carrier_agreements to authenticated;
grant update (name, api_user, account_no, api_key, is_active)
  on public.carrier_agreements to authenticated;
grant delete on public.carrier_agreements to authenticated;

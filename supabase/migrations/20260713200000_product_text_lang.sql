-- Tekst-overrides skal kunne sættes pr. sprog (kunden overstyrer standarden
-- separat for dansk, engelsk, …). Tilføjer 'lang' til nøglen og omskriver
-- replace_product_texts til at erstatte ALLE sprog i ét kald + én revisionspost.

alter table public.product_text_override
  add column if not exists lang text not null default 'da';

-- Fjern enhver eksisterende unik-constraint (den gamle uden 'lang' ville forhindre
-- samme text_key på to sprog) og genopret med sprog i nøglen.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.product_text_override'::regclass and contype = 'u'
  loop
    execute format('alter table public.product_text_override drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.product_text_override
  add constraint product_text_override_unique unique (company_id, product_key, lang, text_key);

-- Fuld erstatning pr. produkt (alle sprog) i én transaktion + én logpost.
-- p_overrides: { "<lang>": { "<text_key>": "<value>", ... }, ... } — kun udfyldte.
-- Drop først: den tidligere version havde parameternavnet p_values (kan ikke
-- omdøbes via create or replace).
drop function if exists public.replace_product_texts(uuid, text, jsonb);

create or replace function public.replace_product_texts(
  p_company_id uuid,
  p_product_key text,
  p_overrides jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not ((p_company_id = public.current_company_id() and public.has_role('manager'))
          or public.is_platform_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  delete from public.product_text_override
    where company_id = p_company_id and product_key = p_product_key;

  insert into public.product_text_override (company_id, product_key, lang, text_key, value)
  select p_company_id, p_product_key, l.key, kv.key, kv.value
  from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) as l,
       lateral jsonb_each_text(l.value) as kv
  where kv.value is not null and btrim(kv.value) <> '';
  get diagnostics v_count = row_count;

  perform public.record_audit(p_company_id, 'product_text.updated', 'product_text', p_product_key,
    p_product_key, jsonb_build_object('count', v_count));
end;
$$;

revoke execute on function public.replace_product_texts(uuid, text, jsonb) from public, anon;
grant execute on function public.replace_product_texts(uuid, text, jsonb) to authenticated;

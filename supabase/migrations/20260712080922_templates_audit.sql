-- Revisionslog for skabeloner: platformens (Operia → Skabeloner) og
-- virksomhedernes overrides (Konfigurér → Skabeloner). Den gemte skabelon
-- (titel + indhold) lægges i detail, så loggen samtidig er en
-- versionshistorik. Sletning af en virksomheds-override logges som
-- template.reset (platformens standard gælder igen).

create or replace function public.audit_platform_templates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(null, 'template.created', 'platform_template',
      new.key || ':' || new.lang, new.name,
      jsonb_build_object('lang', new.lang, 'kind', new.kind, 'title', new.title, 'body', new.body));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.title is distinct from old.title or new.body is distinct from old.body
       or new.name is distinct from old.name then
      perform public.record_audit(null, 'template.updated', 'platform_template',
        new.key || ':' || new.lang, new.name,
        jsonb_build_object('lang', new.lang, 'kind', new.kind, 'title', new.title, 'body', new.body));
    end if;
    return new;
  else
    perform public.record_audit(null, 'template.deleted', 'platform_template',
      old.key || ':' || old.lang, old.name);
    return old;
  end if;
end;
$$;

create or replace function public.audit_company_templates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'template.created', 'company_template',
      new.key || ':' || new.lang, new.key,
      jsonb_build_object('lang', new.lang, 'kind', new.kind, 'title', new.title, 'body', new.body));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.title is distinct from old.title or new.body is distinct from old.body then
      perform public.record_audit(new.company_id, 'template.updated', 'company_template',
        new.key || ':' || new.lang, new.key,
        jsonb_build_object('lang', new.lang, 'kind', new.kind, 'title', new.title, 'body', new.body));
    end if;
    return new;
  else
    -- Override slettet = nulstillet til platformens standard.
    perform public.record_audit(old.company_id, 'template.reset', 'company_template',
      old.key || ':' || old.lang, old.key);
    return old;
  end if;
end;
$$;

create trigger audit_platform_templates_trg
  after insert or update or delete on public.platform_templates
  for each row execute function public.audit_platform_templates();

create trigger audit_company_templates_trg
  after insert or update or delete on public.company_templates
  for each row execute function public.audit_company_templates();

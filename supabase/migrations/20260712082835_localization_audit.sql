-- Revisionslog for sprog- og valutaændringer: virksomhedernes lokalisering
-- (companies-kolonnerne) og platformens udvalg/standarder (platform_settings).
-- Hændelser pr. felt med fra/til i detail.
create or replace function public.audit_company_localization()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.default_language is distinct from old.default_language then
    perform public.record_audit(new.id, 'language.default_changed', 'company', new.id::text,
      new.name, jsonb_build_object('from', old.default_language, 'to', new.default_language));
  end if;
  if new.supported_languages is distinct from old.supported_languages then
    perform public.record_audit(new.id, 'language.supported_changed', 'company', new.id::text,
      new.name, jsonb_build_object('from', old.supported_languages, 'to', new.supported_languages));
  end if;
  if new.default_currency is distinct from old.default_currency then
    perform public.record_audit(new.id, 'currency.default_changed', 'company', new.id::text,
      new.name, jsonb_build_object('from', old.default_currency, 'to', new.default_currency));
  end if;
  if new.supported_currencies is distinct from old.supported_currencies then
    perform public.record_audit(new.id, 'currency.supported_changed', 'company', new.id::text,
      new.name, jsonb_build_object('from', old.supported_currencies, 'to', new.supported_currencies));
  end if;
  return new;
end;
$$;

create or replace function public.audit_platform_localization()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.default_language is distinct from old.default_language then
    perform public.record_audit(null, 'language.default_changed', 'platform_settings', 'platform',
      null, jsonb_build_object('from', old.default_language, 'to', new.default_language));
  end if;
  if new.supported_languages is distinct from old.supported_languages then
    perform public.record_audit(null, 'language.supported_changed', 'platform_settings', 'platform',
      null, jsonb_build_object('from', old.supported_languages, 'to', new.supported_languages));
  end if;
  if new.default_currency is distinct from old.default_currency then
    perform public.record_audit(null, 'currency.default_changed', 'platform_settings', 'platform',
      null, jsonb_build_object('from', old.default_currency, 'to', new.default_currency));
  end if;
  if new.supported_currencies is distinct from old.supported_currencies then
    perform public.record_audit(null, 'currency.supported_changed', 'platform_settings', 'platform',
      null, jsonb_build_object('from', old.supported_currencies, 'to', new.supported_currencies));
  end if;
  return new;
end;
$$;

create trigger audit_company_localization_trg
  after update on public.companies
  for each row execute function public.audit_company_localization();

create trigger audit_platform_localization_trg
  after update on public.platform_settings
  for each row execute function public.audit_platform_localization();

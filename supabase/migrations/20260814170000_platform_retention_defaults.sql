-- Platformens standard-opbevaringsperioder: audit af alle otte kategorier.
--
-- 20260814140000 tilføjede fem nye standardkolonner på platform_settings
-- (parcels/notifications/asset_loans/employees/routes), men audit-triggerne
-- kendte kun de tre gamle: audit_platform_retention() dækkede audit+import, og
-- audit_platform_file_retention() dækkede pakkefiler. En platform-admin kunne
-- altså sætte en standard, der sletter kundedata, uden at det efterlod spor.
--
-- Her samles de otte i ÉN trigger — samme handling ('retention.changed') som
-- før, så loggens historik stadig hænger sammen, men med før/efter pr. ændret
-- felt i stedet for en enkelt værdi. De to gamle triggere ville ellers logge
-- dobbelt, så filtriggeren fjernes sammen med sin nu ubrugte funktion.

create or replace function public.audit_platform_retention()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cols text[] := array[
    'audit_retention_days', 'import_retention_days', 'parcel_files_retention_days',
    'parcels_retention_days', 'notifications_retention_days',
    'asset_loans_retention_days', 'employees_retention_days', 'routes_retention_days'
  ];
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_from jsonb := '{}'::jsonb;
  v_to jsonb := '{}'::jsonb;
  c text;
begin
  foreach c in array v_cols loop
    if v_old -> c is distinct from v_new -> c then
      v_from := v_from || jsonb_build_object(c, v_old -> c);
      v_to := v_to || jsonb_build_object(c, v_new -> c);
    end if;
  end loop;

  if v_to <> '{}'::jsonb then
    perform public.record_audit(null, 'retention.changed', 'platform_settings', 'platform', null,
      jsonb_build_object('from', v_from, 'to', v_to));
  end if;
  return new;
end;
$$;

drop trigger if exists platform_settings_file_retention_audit on public.platform_settings;
drop function if exists public.audit_platform_file_retention();

comment on column public.platform_settings.parcels_retention_days is
  'Standard for kategorien parcels. Kunden kan overskrive i company_retention. NULL = gem indtil videre.';
comment on column public.platform_settings.notifications_retention_days is
  'Standard for kategorien notifications. NULL = gem indtil videre.';
comment on column public.platform_settings.asset_loans_retention_days is
  'Standard for kategorien asset_loans. NULL = gem indtil videre.';
comment on column public.platform_settings.employees_retention_days is
  'Standard for kategorien employees (anonymisering, ikke sletning). NULL = gem indtil videre.';
comment on column public.platform_settings.routes_retention_days is
  'Standard for kategorien routes. NULL = gem indtil videre.';

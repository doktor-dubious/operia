-- Aktiv-/lagerimport genbruger import_configs (import_type = 'assets' | 'inventory').
-- Den oprindelige tjek-betingelse krævede altid medarbejderfelterne
-- ({employee_no,name}); den gør nu de obligatoriske felter afhængige af
-- import_type, så aktiver kræver {asset_tag,name} og lagervarer {sku,name}.
do $$
declare
  c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.import_configs'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%employee_no%name%';
  if c is not null then
    execute format('alter table public.import_configs drop constraint %I', c);
  end if;
end $$;

alter table public.import_configs
  add constraint import_configs_required_fields check (
    (import_type = 'employees' and fields @> '{employee_no,name}')
    or (import_type = 'assets' and fields @> '{asset_tag,name}')
    or (import_type = 'inventory' and fields @> '{sku,name}')
  );

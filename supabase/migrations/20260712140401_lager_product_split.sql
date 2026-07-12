-- Lager udskilles som selvstændigt produkt (prototypens endelige model,
-- jf. split-assets-lager.sql): lagerstyring kan sælges uden aktivsporing.
--  - Nyt produkt 'lager'.
--  - Kunder med den gamle warehouse-FUNKTION får lager-PRODUKTET (ingen har
--    den endnu i praksis — medtaget for idempotens/miljødrift).
--  - 'Håndterminal: Lager' flytter til Lager-produktet.
--  - warehouse-funktionen udgår (erstattet af produktet); tildelinger
--    kaskade-slettes og logges via de eksisterende audit-triggere.

insert into public.product_catalog (key, name, description, name_en, description_en, sort_order)
values (
  'lager',
  'Lager',
  'Lagerstyring: forbrugsvarer på antal, genbestillingspunkt og lagerbevægelser',
  'Inventory',
  'Stock management: quantity-based consumables, reorder points and stock movements',
  25
)
on conflict (key) do nothing;

insert into public.company_products (company_id, product_key, valid_until)
select company_id, 'lager', valid_until
from public.company_features
where feature_key = 'warehouse'
on conflict (company_id, product_key) do nothing;

update public.feature_catalog set product_key = 'lager' where key = 'hh_stock';

delete from public.feature_catalog where key = 'warehouse';

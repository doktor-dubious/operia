-- Pakkelabel-skabelon (fra prototypens label-designer): platform_templates
-- får en kind-kolonne, så skabeloner kan være tekst (title/body-editor)
-- eller label (grafisk designer; body indeholder designet som JSON).

alter table public.platform_templates
  add column kind text not null default 'text' check (kind in ('text', 'label'));

insert into public.platform_templates (key, lang, name, kind, title, body) values
  (
    'package_label',
    'da',
    'Package Label',
    'label',
    '',
    '{"size":"small","width":62,"height":29,"barcodeFrom":"parcel","headingText":"PAKKE","fields":["reference","barcode"],"elements":{"barcode":{"x":50,"y":40,"width":70},"reference":{"x":50,"y":84,"fontSize":8,"bold":false,"align":"center"}},"customTexts":[]}'
  ),
  (
    'package_label',
    'en',
    'Package Label',
    'label',
    '',
    '{"size":"small","width":62,"height":29,"barcodeFrom":"parcel","headingText":"PACKAGE","fields":["reference","barcode"],"elements":{"barcode":{"x":50,"y":40,"width":70},"reference":{"x":50,"y":84,"fontSize":8,"bold":false,"align":"center"}},"customTexts":[]}'
  )
on conflict (key, lang) do nothing;

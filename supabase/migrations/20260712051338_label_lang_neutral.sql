-- Label-skabeloner bliver sprogneutrale i layoutet: én række (lang = '*')
-- hvor kun teksterne ligger pr. sprog inde i designet
-- (texts[lang][element-id]; 'heading' er overskriften). Ellers skulle hver
-- layoutjustering gentages i alle sprog. Migrerer de to package_label-rækker
-- (da/en) til én række og flytter headingText/customTexts-tekster ind i texts.
do $$
declare
  da_body jsonb;
  en_body jsonb;
  da_texts jsonb;
  en_texts jsonb;
  new_customs jsonb := '[]'::jsonb;
  item jsonb;
  en_item jsonb;
begin
  select body::jsonb into da_body
    from public.platform_templates where key = 'package_label' and lang = 'da';
  if da_body is null then
    return; -- allerede migreret (eller aldrig seedet)
  end if;
  select body::jsonb into en_body
    from public.platform_templates where key = 'package_label' and lang = 'en';

  da_texts := jsonb_build_object('heading', coalesce(da_body->>'headingText', 'PAKKE'));
  en_texts := jsonb_build_object('heading', coalesce(en_body->>'headingText', 'PACKAGE'));

  -- Custom-tekstfelter: layoutet (id + position i elements) beholdes; selve
  -- teksten flyttes til texts pr. sprog. Matches på id; da er kanonisk.
  for item in
    select * from jsonb_array_elements(coalesce(da_body->'customTexts', '[]'::jsonb))
  loop
    new_customs := new_customs || jsonb_build_array(jsonb_build_object('id', item->>'id'));
    da_texts := da_texts || jsonb_build_object(item->>'id', coalesce(item->>'text', ''));
    select e into en_item
      from jsonb_array_elements(coalesce(en_body->'customTexts', '[]'::jsonb)) e
      where e->>'id' = item->>'id';
    en_texts := en_texts
      || jsonb_build_object(item->>'id', coalesce(en_item->>'text', item->>'text', ''));
  end loop;

  da_body := (da_body - 'headingText' - 'customTexts')
    || jsonb_build_object(
         'customTexts', new_customs,
         'texts', jsonb_build_object('da', da_texts, 'en', en_texts)
       );

  delete from public.platform_templates where key = 'package_label' and lang = 'en';
  update public.platform_templates
    set lang = '*', body = da_body::text
    where key = 'package_label' and lang = 'da';
end $$;

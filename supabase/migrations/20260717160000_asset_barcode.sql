-- Valgfri stregkode på aktiver.
--
-- Unik pr. virksomhed som asset_tag: en scanning skal kunne pege på præcis ét
-- aktiv, ellers er koden ubrugelig til det den er til for. Postgres lader
-- null'er sameksistere i et unikt indeks, så "ingen stregkode" er stadig
-- lovligt for vilkårligt mange aktiver.
alter table public.assets add column barcode text;

alter table public.assets
  add constraint assets_company_id_barcode_key unique (company_id, barcode);

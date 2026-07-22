-- Klienterne (web + håndterminal) fjerner nu altid AIM-symbologi-id'et
-- (]Q1/]C1/]d2 …) fra scannede koder, før de gemmes eller slås op. Pakker
-- registreret FØR den ændring kan stå med præfikset i barcode og ville derfor
-- ikke længere kunne findes ved scanning. Normalisér bestanden, så gemte koder
-- matcher det, opslagene nu sender.
--
-- Statusløs UPDATE ⇒ log_parcel_event skriver ingen hændelse, og parcels_guard
-- validerer kun barcode ved INSERT. Skulle koden bestå af præfikset alene,
-- falder vi tilbage til en intern OPR-kode (samme invariant som ved intake).
update public.parcels
set barcode = coalesce(
  nullif(btrim(regexp_replace(barcode, '^\][A-Za-z][0-9]', '')), ''),
  public.generate_parcel_barcode(company_id))
where barcode ~ '^\][A-Za-z][0-9]';

-- Stregkode-værn (aktiver + pakker): en stregkode er en OPAK identifikator —
-- symbologi og tegnsæt begrænses bevidst IKKE (Code 128/QR er alfanumeriske,
-- og systemets egne koder OPR-/OPB-/aktiv-tags er det også). Men to hårde
-- grænser håndhæves i databasen, så alle indgange (web, håndterminal, import)
-- er dækket:
--   * maks. 128 tegn — en QR kan bære kilobytes (URL'er, JSON), og stregkoden
--     kopieres ind i de immutable hændelseslogge, hvor den aldrig kan slettes
--   * ingen kontroltegn — 2D-payloads kan indeholde linjeskift m.m.
-- URL-lignende koder ADVARES der om i webbens UI (warn-and-allow: en
-- leverandørs QR-label må gerne adopteres som identifikator) — det er ikke en
-- databaseregel. Eksisterende data er verificeret rene (maks. 18 tegn).

alter table public.assets
  add constraint assets_barcode_sane check (
    barcode is null
    or (char_length(barcode) <= 128 and barcode !~ '[[:cntrl:]]')
  );

alter table public.parcels
  add constraint parcels_barcode_sane check (
    barcode is null
    or (char_length(barcode) <= 128 and barcode !~ '[[:cntrl:]]')
  );

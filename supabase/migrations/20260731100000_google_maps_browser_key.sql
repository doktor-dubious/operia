-- Google Maps kræver TO nøgler, fordi de to sider af integrationen har
-- forskellige trusselsmodeller:
--
--   1. Server-nøglen (edge-secret GOOGLE_MAPS_API_KEY) bruges af route-calc til
--      Geocoding API + Routes API. Den forlader aldrig serveren og bør i Google
--      Cloud begrænses til netop de to API'er.
--   2. Browser-nøglen (denne kolonne) bruges af Maps JavaScript API, som pr.
--      design kører i brugerens browser. Den KAN ikke holdes hemmelig — den
--      ligger i sidekilden hos enhver bruger. Google beskytter den i stedet med
--      HTTP-referrer-begrænsning (fx https://operia.predictioninstitute.com/*)
--      plus API-begrænsning til kun Maps JavaScript API.
--
-- Derfor er det korrekt — ikke en lækage — at kolonnen er læsbar for alle
-- authenticated brugere via den eksisterende platform_settings_select-politik:
-- ruteplanlæggeren skal kunne hente den for at tegne kortet. Skriv kun en
-- referrer-begrænset browser-nøgle her, ALDRIG server-nøglen.
alter table public.platform_settings
  add column google_maps_browser_key text;

comment on column public.platform_settings.google_maps_browser_key is
  'Referrer-begrænset Google Maps JavaScript API-nøgle. Offentlig pr. design (sendes til browseren). Aldrig server-nøglen.';

-- Audit (NIS2): udvider maps-triggeren så også nøgle-ændringer logges. Selve
-- nøgleværdien logges ikke — kun at den blev sat, ændret eller fjernet.
create or replace function public.audit_platform_maps_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.maps_provider is distinct from old.maps_provider then
    perform public.record_audit(null, 'maps.changed', 'platform_settings', 'platform', null,
      jsonb_build_object('from', old.maps_provider, 'to', new.maps_provider));
  end if;

  if new.google_maps_browser_key is distinct from old.google_maps_browser_key then
    perform public.record_audit(null, 'maps.changed', 'platform_settings', 'platform', null,
      jsonb_build_object(
        'field', 'google_maps_browser_key',
        'action', case
          when old.google_maps_browser_key is null then 'set'
          when new.google_maps_browser_key is null then 'cleared'
          else 'rotated'
        end));
  end if;

  return new;
end;
$$;

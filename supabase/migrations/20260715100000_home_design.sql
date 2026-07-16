-- Operia-konfiguration → Home-design: udvid designet ud over fliserne med et
-- indstillingsobjekt (kolonner/rækker i rutenettet, farvetema, samt
-- velkomsttitel, undertitel, logo og hero-billede — hver med et til/fra-flag,
-- så elementet kan udelades fra Home). Gemmes som ét JSONB-objekt på
-- singleton-rækken platform_settings, ved siden af home_tiles.
alter table public.platform_settings
  add column home_design jsonb not null default jsonb_build_object(
    'maxCols', 4,
    'maxRows', 3,
    'theme', 'metro',
    'welcomeTitle', '',
    'welcomeTitleEnabled', false,
    'subtitle', '',
    'subtitleEnabled', true,
    'logoUrl', '',
    'logoEnabled', false,
    'heroUrl', '',
    'heroEnabled', false
  );

-- Audit (NIS2): 'home.updated' skal nu også dække ændringer af
-- indstillingsobjektet, ikke kun fliselayoutet. Ellers uændret.
create or replace function public.audit_platform_home_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.home_tiles is distinct from old.home_tiles
     or new.home_design is distinct from old.home_design then
    perform public.record_audit(null, 'home.updated', 'platform_settings', 'home', null,
      jsonb_build_object(
        'tiles', jsonb_array_length(new.home_tiles),
        'design', new.home_design
      ));
  end if;
  return new;
end;
$$;

-- Håndterminal: Flyt (relokering). Flow 2 — hver intern flytning scannes:
-- pakken flyttes til en ny placering og/eller får en flytte-status
-- (in_storage / in_transit / in_locker). Egen entitlement-feature som de øvrige
-- håndterminal-funktioner, så platform-admins kan slå den til/fra pr. kunde.

insert into public.feature_catalog (key, product_key, name, description, name_en, description_en) values
  ('hh_move', 'parcels', 'Håndterminal: Flyt', 'Flyt pakker internt på håndterminalen (scan → ny placering/status)',
   'Handheld: Move', 'Relocate parcels internally on the handheld (scan → new location/status)')
on conflict (key) do nothing;

-- Giv adgang til de kunder, der allerede kan udlevere på håndterminalen: flytning
-- er en pakkehåndterer-funktion på linje med udlevering, så samme kunder får den.
-- Uden dette ville en kunde med konfigurerede hh_-features ikke se flisen (has()
-- viser kun eksplicit tildelte features, når mindst én hh_-feature findes).
insert into public.company_features (company_id, feature_key)
select company_id, 'hh_move'
from public.company_features
where feature_key = 'hh_handout'
on conflict (company_id, feature_key) do nothing;

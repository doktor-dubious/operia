-- Håndterminal: Tilstand (dokumentation). Tilføj fotos + noter til en pakke på
-- håndterminalen. Egen entitlement-feature som de øvrige håndterminal-funktioner.

insert into public.feature_catalog (key, product_key, name, description, name_en, description_en) values
  ('hh_condition', 'parcels', 'Håndterminal: Tilstand', 'Dokumentér pakker med fotos og noter på håndterminalen',
   'Handheld: Condition', 'Document parcels with photos and notes on the handheld')
on conflict (key) do nothing;

-- Giv adgang til de kunder, der allerede kan udlevere på håndterminalen.
insert into public.company_features (company_id, feature_key)
select company_id, 'hh_condition'
from public.company_features
where feature_key = 'hh_handout'
on conflict (company_id, feature_key) do nothing;

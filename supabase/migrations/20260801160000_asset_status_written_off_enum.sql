-- Ny aktivstatus: 'written_off' (Afskrevet) — aktivet var ude (tildelt,
-- udlånt eller til service), modtageren leverer ikke tilbage, og ejeren har
-- opgivet at få det igen. Adskilt fra 'retired' (planlagt udfasning af noget
-- man HAR): afskrivning er et tab af varetægt, og den sidst kendte holder
-- bevares som chain of custody.
--
-- Nye enum-værdier kan ikke bruges i samme transaktion som de tilføjes —
-- selve flowet (write_off_asset m.m.) kommer i næste migration.

alter type public.asset_status add value if not exists 'written_off';

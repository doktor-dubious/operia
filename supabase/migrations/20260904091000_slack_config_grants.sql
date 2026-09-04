-- Stram rettighederne på company_slack_config til præcis det UI'et skal bruge.
--
-- Baggrund: Supabase-projektets default ACL på schema public giver anon og
-- authenticated ALLE rettigheder (arwdDxtm) på hver ny tabel. Et 'grant select'
-- i opret-migrationen tilføjer derfor ingenting — tabellen havde i forvejen
-- insert/update/delete/truncate.
--
-- I praksis holder RLS de fire første i skak (tabellen har kun en SELECT-
-- politik, og manglende politik = afvist). Men TRUNCATE er IKKE omfattet af
-- row level security: den styres alene af tabelrettigheden. PostgREST udsteder
-- ganske vist aldrig TRUNCATE, så der er ikke en åben dør her — det er
-- dybdeforsvar: rettigheden skal ikke ligge og vente på den dag noget andet end
-- PostgREST får forbindelsen.
--
-- Samme mønster gælder ~54 andre tabeller i projektet. De ryddes for sig, så
-- denne migration bliver ved sit emne.

revoke all on public.company_slack_config from anon, authenticated;
grant select on public.company_slack_config to authenticated;

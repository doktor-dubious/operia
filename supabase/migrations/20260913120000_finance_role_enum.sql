-- Økonomirollen (EVU-krav F-01, C-08) — første halvdel: selve enum-værdien.
--
-- To migrationer, fordi Postgres ikke tillader, at en ny enum-værdi BRUGES i
-- samme transaktion, som den tilføjes i. Politikker og funktioner, der
-- refererer 'finance_manager', ligger derfor i den næste fil.
alter type public.app_role add value if not exists 'finance_manager';

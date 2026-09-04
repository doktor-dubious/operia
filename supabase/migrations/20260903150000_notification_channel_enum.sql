-- Nye notifikationskanaler: Microsoft Teams og Slack.
--
-- Enum-værdierne står ALENE i denne migration med vilje. Postgres tillader
-- 'alter type ... add value' i en transaktion, men den nye værdi må ikke BRUGES
-- i samme transaktion. Ved at lægge tilføjelsen i sin egen fil kan senere
-- migrationer (og dispatcheren) referere kanalerne uden at ramme den regel.
--
-- Selve afsendelsen bygges senere (Slack: OAuth-installation + chat.postMessage;
-- Teams: Bot Framework proaktiv 1:1-besked). Denne omgang gør rørene
-- kanal-generiske: enum, indstillinger, tilvalg og skabeloner.

alter type public.notification_channel add value if not exists 'teams';
alter type public.notification_channel add value if not exists 'slack';

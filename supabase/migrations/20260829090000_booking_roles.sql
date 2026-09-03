-- Booking-produktet, del 0: rollerne.
--
-- Nye enum-værdier kan ikke bruges i samme transaktion som de tilføjes
-- (samme grund som 20260719090000), så policies/RPC'er der bruger dem ligger i
-- den efterfølgende migration (20260829090100_booking_core).
--
--   booking_manager — stamdata (ressourcer, kategorier), indstillinger og alle
--                     booking-handlinger
--   booking_handler — opret/redigér/annullér bookinger (fx reception)

alter type public.app_role add value if not exists 'booking_manager';
alter type public.app_role add value if not exists 'booking_handler';

-- Stram udgivelses-knappen: indtil videre må kun rune@predictioninstitute.com
-- bestille en håndterminal-udgivelse. Deploy-workeren kører på Runes bygge-
-- maskine, så andre platform-admins skal ikke kunne trykke på en knap, der
-- afhænger af den. Fjern e-mail-tjekket igen, når bygningen flyttes til CI.

drop policy handheld_deploys_insert on public.handheld_deploys;

create policy handheld_deploys_insert on public.handheld_deploys
  for insert to authenticated
  with check (
    public.is_platform_admin()
    and requested_by = auth.uid()
    and (auth.jwt() ->> 'email') = 'rune@predictioninstitute.com'
  );

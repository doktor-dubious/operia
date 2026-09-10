-- Revisionsspor for booking-eksport (EVU-krav B-01).
--
-- Et udtræk af bookinger og afregningsdata tager persondata UD af systemet:
-- medarbejdernavne og bookingernes fritekst-formål havner i en fil, vi ikke
-- længere har hånd om. Alt andet, der trækker persondata ud, efterlader et
-- spor (indsigtsudtrækket skriver 'privacy.sar_exported', AI-aflæsninger
-- skriver 'ai.label_read'), og det skal det her også.
--
-- HVAD DER LOGGES: hvem, hvornår, hvilket udsnit, hvor mange rækker og hvilke
-- kolonner. IKKE indholdet — hverken navne eller formål. audit_log er
-- uforanderlig og videresendes til kundens log drains, så data i den kan
-- aldrig trækkes tilbage; sporet skal vise AT der blev eksporteret, ikke
-- gentage det eksporterede.
--
-- Selve rækkerne hentes af klienten gennem de RLS-beskyttede tabeller — det er
-- dér "følger de anvendte filtre" giver mening, for filtrene sidder i tabellen
-- brugeren kigger på. Funktionen her er derfor et LOGKALD og ikke datakilden;
-- til gengæld gentjekker den rettigheden, så den loggede vej er den samme vej,
-- som UI'et tilbyder. Bygges den planlagte eksport (B-02) senere, sker både
-- udtræk og logning server-side.
create or replace function public.log_booking_export(
  p_company_id uuid,
  p_scope text,
  p_rows integer,
  p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_detail jsonb;
begin
  if not public.can_manage_bookings(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Kun kendte, korte maskinværdier slipper igennem: en fri jsonb fra
  -- browseren ville ellers kunne skrive hvad som helst (fx et bookingformål)
  -- i den uforanderlige log.
  v_detail := jsonb_build_object(
    'scope', left(coalesce(p_scope, ''), 40),
    'rows', greatest(0, coalesce(p_rows, 0)),
    'shape', left(coalesce(p_detail->>'shape', ''), 40),
    'profile', left(coalesce(p_detail->>'profile', ''), 40),
    'columns', coalesce(p_detail->'columns', '[]'::jsonb)
  );

  perform public.record_audit(
    p_company_id, 'booking.exported', 'booking',
    left(coalesce(p_detail->>'entity_id', p_company_id::text), 64),
    coalesce(p_rows, 0)::text,
    v_detail);
end;
$fn$;

revoke execute on function public.log_booking_export(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.log_booking_export(uuid, text, integer, jsonb) to authenticated;

comment on function public.log_booking_export(uuid, text, integer, jsonb) is
  'Revisionsspor for booking-eksport (B-01). Logger hvem/hvornår/udsnit/antal/kolonner — aldrig indholdet.';

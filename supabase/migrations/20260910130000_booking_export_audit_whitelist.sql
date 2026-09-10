-- Rettelse til revisionssporet for booking-eksport (20260910120000).
--
-- Fundet af supabase/tests/booking_export.sql: den første udgave BEGRÆNSEDE
-- længden af 'scope' og 'shape' (left(..., 40)) men filtrerede dem ikke. En
-- klient kunne derfor sende "Møde med Anna om fratrædelse" som udsnit, og
-- teksten landede uforkortet i audit_log — præcis den fritekst, funktionen var
-- skrevet for at holde ude. En længdegrænse er ikke et filter.
--
-- Nu hvidlistes værdierne i stedet: kun de maskinkoder, UI'et rent faktisk
-- bruger, slipper igennem; alt andet bliver til 'other'. Kolonnenavne skal
-- ligne kolonnenavne (små bogstaver og understreg), og der er et loft over
-- antallet. Så kan sporet stadig fortælle HVAD der blev trukket ud, uden at
-- kunne bruges som skjult tekstfelt i en log, der aldrig kan rettes.
create or replace function public.log_booking_export(
  p_company_id uuid,
  p_scope text,
  p_rows integer,
  p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_scope text;
  v_shape text;
  v_profile text;
  v_columns jsonb;
  v_entity text;
begin
  if not public.can_manage_bookings(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_scope := case
    when p_scope in ('booking', 'resource', 'timeframe', 'filtered', 'selected') then p_scope
    else 'other'
  end;
  v_shape := case
    when p_detail->>'shape' in ('bookings', 'lines') then p_detail->>'shape'
    else 'other'
  end;
  v_profile := case
    when p_detail->>'profile' in ('operia', 'excel_da', 'dalux') then p_detail->>'profile'
    else 'other'
  end;

  -- Kolonnenavne: kun feltnøgle-form, højst 40 af dem.
  select coalesce(jsonb_agg(c order by c), '[]'::jsonb) into v_columns
  from (
    select value as c
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_detail->'columns') = 'array'
           then p_detail->'columns' else '[]'::jsonb end)
    where value ~ '^[a-z][a-z_]{0,39}$'
    limit 40
  ) x;

  -- entity_id skal være et id, ikke en besked.
  v_entity := case
    when p_detail->>'entity_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then p_detail->>'entity_id'
    else p_company_id::text
  end;

  perform public.record_audit(
    p_company_id, 'booking.exported', 'booking', v_entity,
    greatest(0, coalesce(p_rows, 0))::text,
    jsonb_build_object(
      'scope', v_scope,
      'rows', greatest(0, coalesce(p_rows, 0)),
      'shape', v_shape,
      'profile', v_profile,
      'columns', v_columns));
end;
$fn$;

revoke execute on function public.log_booking_export(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.log_booking_export(uuid, text, integer, jsonb) to authenticated;

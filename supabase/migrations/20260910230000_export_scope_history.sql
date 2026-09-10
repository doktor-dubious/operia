-- Historik-eksport med i revisionssporet (EVU-krav D-06).
--
-- log_booking_export hvidlister 'scope' og 'shape' mod de værdier, UI'et
-- bruger (20260910130000) — netop for at fritekst ikke kan snige sig ind i den
-- uforanderlige log. Historikken er en ny slags udtræk og skal derfor optages i
-- listen; ellers ville den blive logget som 'other' og ikke kunne skelnes fra
-- en fejlkaldt eksport.
--
-- Funktionen er ellers uændret: 'history' føjes til begge hvidlister, og
-- 'shape' rummer nu også de tre filformater, historikken kan hentes i.
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
    when p_scope in ('booking', 'resource', 'timeframe', 'filtered', 'selected', 'history')
      then p_scope
    else 'other'
  end;
  v_shape := case
    when p_detail->>'shape' in ('bookings', 'lines', 'history') then p_detail->>'shape'
    else 'other'
  end;
  v_profile := case
    when p_detail->>'profile' in ('operia', 'excel_da', 'dalux', 'csv', 'pdf', 'docx')
      then p_detail->>'profile'
    else 'other'
  end;

  select coalesce(jsonb_agg(c order by c), '[]'::jsonb) into v_columns
  from (
    select value as c
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_detail->'columns') = 'array'
           then p_detail->'columns' else '[]'::jsonb end)
    where value ~ '^[a-z][a-z_]{0,39}$'
    limit 40
  ) x;

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

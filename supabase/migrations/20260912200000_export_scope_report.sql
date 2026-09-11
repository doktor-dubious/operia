-- Eksport fra bookingrapporten (EVU-krav E-01/E-03): 'report' som udsnit og
-- rækkeform i revisionssporets hvidliste. Samme regel som 20260910130000: alt,
-- der ikke står her, logges som 'other' — en længdebegrænsning er ikke et filter.

CREATE OR REPLACE FUNCTION public.log_booking_export(p_company_id uuid, p_scope text, p_rows integer, p_detail jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    when p_scope in ('booking', 'resource', 'timeframe', 'filtered', 'selected', 'history', 'report')
      then p_scope
    else 'other'
  end;
  v_shape := case
    when p_detail->>'shape' in ('bookings', 'lines', 'history', 'report') then p_detail->>'shape'
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
$function$

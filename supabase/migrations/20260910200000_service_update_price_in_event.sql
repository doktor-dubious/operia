-- Beløbskonsekvensen skal kunne læses ud af hændelsen alene (EVU-krav D-04).
--
-- 'service_added' og 'service_removed' bar allerede enhedspris og pristype, så
-- linjens beløb kan regnes ud af hændelsen selv. 'service_updated' bar kun
-- antallet før og efter — og så kan man ikke se, hvad ændringen betød for
-- fakturagrundlaget uden at slå prisen op et andet sted: enten på linjen, som
-- kan være fjernet siden, eller i kataloget, hvis pris kan være ændret. Begge
-- veje giver det forkerte svar for en historisk hændelse.
--
-- Funktionen er ellers uændret.
create or replace function public.update_booking_service(p_line_id uuid, p_quantity integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_line public.booking_service_lines;
begin
  select * into v_line from public.booking_service_lines where id = p_line_id for update;
  if not found then
    raise exception 'booking_service_line_not_found' using errcode = 'P0002';
  end if;
  perform public.assert_booking_open(v_line.booking_id);

  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception 'booking_invalid_quantity' using errcode = 'P0001';
  end if;

  update public.booking_service_lines set quantity = p_quantity where id = v_line.id;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_line.booking_id, v_line.company_id, 'service_updated', auth.uid(),
     jsonb_build_object(
       'service_id', v_line.service_id,
       'from_quantity', v_line.quantity,
       'to_quantity', p_quantity,
       -- Prisen med, så linjens beløbskonsekvens kan regnes ud af hændelsen
       -- ALENE (EVU D-04). Uden den skulle man slå linjen op — som måske er
       -- væk — eller kataloget, hvis pris kan være ændret siden.
       'unit_price', v_line.unit_price,
       'price_mode', v_line.price_mode));
end;
$function$;

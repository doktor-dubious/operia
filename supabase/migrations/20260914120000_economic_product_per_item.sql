-- Produktnummer i e-conomic dér, hvor momskoden bor (EVU C-02/C-06, A-06).
--
-- Mapningen havde ét produkt pr. LINJETYPE: alle lokaler på ét produkt, alle
-- tilkøb på ét. Det holder for lokaler, men ikke for tilkøb: forplejning er
-- momspligtig, kursusmateriale følger typisk undervisningen — begge er
-- "tilkøb", men skal på hver sit produkt (= hver sin konto og moms) i
-- e-conomic. Momskoden fik samme placering 2026-09-13; produktnummeret følger.
--
-- Valgfrit på ydelsen, ressourcekategorien og kursistniveauet; de tre
-- typeprodukter i mapningen er fallback. Kladdelinjen husker, hvad den kom af
-- (`ref_id`), så overførslen kan slå produktet op — ved overførslen, ikke ved
-- dannelsen: et produktnummer er rute, ikke fakturagrundlag, og må gerne rettes
-- mellem dannelse og overførsel.

alter table public.booking_services
  add column if not exists economic_product_no text
    check (economic_product_no is null or (char_length(btrim(economic_product_no)) between 1 and 25 and economic_product_no !~ '[[:cntrl:]]'));
alter table public.booking_categories
  add column if not exists economic_product_no text
    check (economic_product_no is null or (char_length(btrim(economic_product_no)) between 1 and 25 and economic_product_no !~ '[[:cntrl:]]'));
alter table public.booking_participant_levels
  add column if not exists economic_product_no text
    check (economic_product_no is null or (char_length(btrim(economic_product_no)) between 1 and 25 and economic_product_no !~ '[[:cntrl:]]'));

-- Hvad linjen kom af: ydelsens, kategoriens eller niveauets id efter `source`.
alter table public.invoice_draft_lines add column if not exists ref_id uuid;

CREATE OR REPLACE FUNCTION public.generate_invoice_draft(p_company_id uuid, p_booking_ids uuid[], p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_draft_id uuid;
  v_number text;
  v_seq bigint;
  v_currency text;
  v_basis text;
  v_tz text;
  b record;
  t record;
  v_days integer;
  v_hours numeric;
  v_qty numeric;
  v_lines integer := 0;
  v_priced boolean;
  v_included uuid[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_sort integer := 0;
  v_from date;
  v_to date;
begin
  if not public.can_edit_invoice_drafts(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_booking_ids is null or array_length(p_booking_ids, 1) is null then
    raise exception 'no_bookings' using errcode = 'P0001';
  end if;

  select default_currency, coalesce(booking_day_basis, 'calendar'), coalesce(timezone, 'Europe/Copenhagen')
    into v_currency, v_basis, v_tz
  from public.companies where id = p_company_id;
  if not found then
    raise exception 'company_not_found' using errcode = 'P0002';
  end if;

  -- Nummeret tages FØR linjerne, så to samtidige kørsler ikke kan få samme.
  insert into public.invoice_draft_seq (company_id, last_value)
  values (p_company_id, 1)
  on conflict (company_id) do update set last_value = public.invoice_draft_seq.last_value + 1
  returning last_value into v_seq;
  v_number := 'FK-' || lpad(v_seq::text, 5, '0');

  insert into public.invoice_drafts (company_id, number, currency, note)
  values (p_company_id, v_number, v_currency, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_draft_id;

  for b in
    select bk.*, r.name as resource_name, l.name as level_name,
           c.vat_code as resource_vat, l.vat_code as level_vat,
           r.category_id as resource_category_id
    from public.bookings bk
    join public.booking_resources r on r.id = bk.resource_id
    left join public.booking_categories c on c.id = r.category_id
    left join public.booking_participant_levels l on l.id = bk.participant_level_id
    where bk.company_id = p_company_id
      and bk.id = any(p_booking_ids)
    -- Rækkefølgen gør kladden læsbar og gentagelig: samme udvalg giver samme
    -- linjerækkefølge, hvilket er en forudsætning for at kunne sammenligne to
    -- kørsler.
    order by bk.starts_at, r.name
    for update of bk
  loop
    if b.status = 'cancelled' then
      v_skipped := v_skipped || jsonb_build_object('booking_id', b.id, 'reason', 'cancelled');
      continue;
    end if;
    if b.invoiced_at is not null then
      v_skipped := v_skipped || jsonb_build_object('booking_id', b.id, 'reason', 'already_invoiced');
      continue;
    end if;
    if b.invoice_draft_id is not null then
      v_skipped := v_skipped || jsonb_build_object('booking_id', b.id, 'reason', 'on_other_draft');
      continue;
    end if;
    -- Samme grænse som set_booking_invoiced (booking_not_completed): en
    -- booking faktureres først, når den er afholdt. Ellers kunne kladden
    -- godkendes og sendes til regnskabssystemet, og først DA blive afvist.
    if b.ends_at > now() then
      v_skipped := v_skipped || jsonb_build_object('booking_id', b.id, 'reason', 'not_completed');
      continue;
    end if;

    v_days := public.booking_day_count(b.starts_at, b.ends_at, v_basis, v_tz);
    v_hours := round(extract(epoch from (b.ends_at - b.starts_at)) / 3600.0, 2);
    v_priced := false;

    -- (a) Lokalet. Én linje pr. takst på ressourcen, fordi et lokale godt kan
    --     have både en dagspris og en pris pr. kursist (C-05/C-07).
    for t in
      select * from public.booking_tariffs_on(p_company_id, b.resource_id, (b.starts_at at time zone v_tz)::date)
    loop
      v_qty := case t.unit
        when 'day' then v_days
        when 'hour' then v_hours
        when 'flat' then 1
        when 'person' then coalesce(b.participant_count, 0)
        when 'person_day' then coalesce(b.participant_count, 0) * v_days
      end;
      -- En takst pr. kursist på en booking uden kursisttal ville blive nul
      -- kroner og ligne en fejl. Den udelades, og bookingen tælles stadig som
      -- prissat, hvis en anden takst gav en linje.
      if v_qty is null or v_qty = 0 then
        continue;
      end if;
      insert into public.invoice_draft_lines (
        company_id, draft_id, booking_id, source, description, quantity, unit,
        unit_price, vat_code, sort_order, ref_id)
      values (
        p_company_id, v_draft_id, b.id, 'resource',
        b.resource_name || ' ' || to_char(b.starts_at at time zone v_tz, 'DD.MM.YYYY')
          || case when ((b.ends_at - interval '1 microsecond') at time zone v_tz)::date > (b.starts_at at time zone v_tz)::date
                  then '–' || to_char((b.ends_at - interval '1 microsecond') at time zone v_tz, 'DD.MM.YYYY') else '' end,
        v_qty, t.unit, t.amount, b.resource_vat, v_sort, b.resource_category_id);
      v_sort := v_sort + 1;
      v_lines := v_lines + 1;
      v_priced := true;
    end loop;

    -- (b) Kursistniveauet (C-07): differentieret takst pr. kursist.
    if b.participant_level_id is not null and coalesce(b.participant_count, 0) > 0 then
      for t in
        select * from public.booking_tariffs_on(p_company_id, b.participant_level_id, (b.starts_at at time zone v_tz)::date)
      loop
        v_qty := case t.unit
          when 'person' then b.participant_count
          when 'person_day' then b.participant_count * v_days
          when 'flat' then 1
          else null            -- dag/time giver ikke mening på et niveau
        end;
        if v_qty is null or v_qty = 0 then
          continue;
        end if;
        insert into public.invoice_draft_lines (
          company_id, draft_id, booking_id, source, description, quantity, unit,
          unit_price, vat_code, sort_order, ref_id)
        values (
          p_company_id, v_draft_id, b.id, 'participants',
          b.level_name || ' (' || b.participant_count::text || ')',
          v_qty, t.unit, t.amount, b.level_vat, v_sort, b.participant_level_id);
        v_sort := v_sort + 1;
        v_lines := v_lines + 1;
        v_priced := true;
      end loop;
    end if;

    -- (c) Tilkøbsydelserne (C-06) — egen linje med egen tekst, antal og
    --     enhedspris. Prisen tages fra LINJENS snapshot og ikke fra
    --     ydelseskataloget: den blev låst, da ydelsen blev sat på bookingen,
    --     og det er den, nogen har godkendt.
    insert into public.invoice_draft_lines (
      company_id, draft_id, booking_id, source, description, quantity, unit,
      unit_price, vat_code, sort_order, ref_id)
    select
      p_company_id, v_draft_id, b.id, 'service', s.name,
      case when sl.price_mode = 'total' then 1 else sl.quantity end,
      'service', sl.unit_price, s.vat_code,
      v_sort + row_number() over (order by s.name), s.id
    from public.booking_service_lines sl
    join public.booking_services s on s.id = sl.service_id
    where sl.booking_id = b.id;
    get diagnostics v_qty = row_count;
    v_sort := v_sort + v_qty::int;
    v_lines := v_lines + v_qty::int;
    if v_qty > 0 then
      v_priced := true;
    end if;

    if not v_priced then
      -- Ingen pris nogen steder. Bookingen ryger ikke stille ud: den står i
      -- svaret, så den, der fakturerer, ved at der mangler en takst.
      v_skipped := v_skipped || jsonb_build_object('booking_id', b.id, 'reason', 'no_price');
      continue;
    end if;

    update public.bookings set invoice_draft_id = v_draft_id where id = b.id;
    v_included := v_included || b.id;
    v_from := least(v_from, (b.starts_at at time zone v_tz)::date);
    v_to := greatest(v_to, ((b.ends_at - interval '1 microsecond') at time zone v_tz)::date);
  end loop;

  if array_length(v_included, 1) is null then
    -- Ingen linjer: kladden ville være tom, og en tom kladde i listen er kun
    -- forvirring. Nummeret er brugt — det er prisen for at kunne nummerere
    -- uden kapløb, og et hul i rækken er bedre end to kladder med samme nummer.
    delete from public.invoice_drafts where id = v_draft_id;
    return jsonb_build_object(
      'draft_id', null, 'number', null, 'lines', 0,
      'included', '[]'::jsonb, 'skipped', v_skipped);
  end if;

  update public.invoice_drafts
     set period_from = v_from, period_to = v_to
   where id = v_draft_id;

  perform public.record_audit(p_company_id, 'invoice_draft.created', 'invoice_draft',
    v_draft_id::text, v_number,
    jsonb_build_object('bookings', array_length(v_included, 1), 'lines', v_lines,
                       'skipped', jsonb_array_length(v_skipped)));

  return jsonb_build_object(
    'draft_id', v_draft_id,
    'number', v_number,
    'lines', v_lines,
    'included', to_jsonb(v_included),
    'skipped', v_skipped);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_credit_note(p_draft_id uuid, p_lines jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record;
  v_id uuid;
  v_seq bigint;
  v_number text;
  v_lines integer := 0;
  l record;
  ln record;
  v_qty numeric;
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then raise exception 'draft_not_found' using errcode = 'P0002'; end if;
  if not public.can_invoice_bookings(d.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if d.kind <> 'invoice' then raise exception 'not_an_invoice' using errcode = 'P0001'; end if;
  if d.status <> 'transferred' then raise exception 'draft_not_transferred' using errcode = 'P0001'; end if;
  if d.credited_by_draft_id is not null then raise exception 'already_credited' using errcode = 'P0001'; end if;
  if exists (select 1 from public.invoice_drafts where credits_draft_id = p_draft_id and status in ('draft', 'approved')) then
    raise exception 'credit_note_open' using errcode = 'P0001';
  end if;

  insert into public.invoice_draft_seq (company_id, last_value)
  values (d.company_id, 1)
  on conflict (company_id) do update set last_value = public.invoice_draft_seq.last_value + 1
  returning last_value into v_seq;
  v_number := 'KN-' || lpad(v_seq::text, 5, '0');

  insert into public.invoice_drafts (company_id, number, kind, credits_draft_id, currency,
                                     bill_to_name, bill_to_ref, period_from, period_to, note)
  values (d.company_id, v_number, 'credit', p_draft_id, d.currency,
          d.bill_to_name, d.bill_to_ref, d.period_from, d.period_to, null)
  returning id into v_id;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    -- Hele fakturaen: hver linje negeret.
    insert into public.invoice_draft_lines (company_id, draft_id, booking_id, source, description,
                                            quantity, unit, unit_price, vat_code, sort_order, ref_id)
    select company_id, v_id, booking_id, source, description,
           -quantity, unit, unit_price, vat_code, sort_order, ref_id
    from public.invoice_draft_lines where draft_id = p_draft_id;
    get diagnostics v_lines = row_count;
  else
    -- Et udvalg: {line_id, quantity} — antallet må ikke overstige linjens
    -- eget. Udelades 'quantity' helt, krediteres hele linjen; er nøglen der,
    -- men tom eller ulæselig (en tastefejl i skærmen bliver til JSON null),
    -- er det en fejl — ikke hele linjen.
    for l in
      select (e->>'line_id')::uuid as line_id,
             (e ? 'quantity') as has_qty,
             case when e->>'quantity' ~ '^-?[0-9]+([.][0-9]+)?$' then (e->>'quantity')::numeric end as qty
      from jsonb_array_elements(p_lines) e
    loop
      select * into ln from public.invoice_draft_lines where id = l.line_id and draft_id = p_draft_id;
      if not found then raise exception 'line_not_on_draft' using errcode = 'P0001'; end if;
      if l.has_qty and l.qty is null then
        raise exception 'credit_quantity_invalid' using errcode = 'P0001';
      end if;
      v_qty := coalesce(l.qty, ln.quantity);
      if v_qty <= 0 or v_qty > ln.quantity then raise exception 'credit_quantity_invalid' using errcode = 'P0001'; end if;
      insert into public.invoice_draft_lines (company_id, draft_id, booking_id, source, description,
                                              quantity, unit, unit_price, vat_code, sort_order, ref_id)
      values (ln.company_id, v_id, ln.booking_id, ln.source, ln.description,
              -v_qty, ln.unit, ln.unit_price, ln.vat_code, ln.sort_order, ln.ref_id);
      v_lines := v_lines + 1;
    end loop;
  end if;

  perform public.record_audit(d.company_id, 'invoice_draft.credit_created', 'invoice_draft',
    v_id::text, v_number, jsonb_build_object('credits', d.number, 'lines', v_lines,
                                              'partial', p_lines is not null));
  return jsonb_build_object('draft_id', v_id, 'number', v_number, 'lines', v_lines);
end;
$function$;

-- Økonomirolle (F-01, C-08), kreditnota (C-09) og beløb i hændelsesloggen (D-04).
-- Anden halvdel af 20260913120000 — enum-værdien er nu committet og må bruges.
--
-- ROLLEN. "En ansvarlig frigiver grundlaget" (C-08) var indtil nu "en
-- bookingansvarlig frigiver": samme rolle bookede, dannede kladden og godkendte
-- den. finance_manager adskiller de to: booking_manager kan stadig danne,
-- rette og annullere kladder, men godkendelse, overførsel og kreditnota kræver
-- manager eller finance_manager. Én person KAN have begge roller — adskillelsen
-- er en mulighed, kunden får, ikke en tvang.
--
-- KREDITNOTAEN er en kladde af arten 'credit' med reference til den overførte
-- faktura og negative linjer — hele fakturaen eller et udvalg af linjer med et
-- antal. Den følger samme godkendelse og overførsel som en faktura, så sporet
-- er ét. Er hele beløbet krediteret, er bookingerne ikke længere fakturerede,
-- og låsen fra A-03 løftes, så de kan rettes og faktureres igen (C-10's "en
-- ændring efter fakturering er en kreditnota, ikke en stille korrektion").
--
-- BELØBET I LOGGEN: hændelsen bærer nu, hvad ændringen betød for
-- fakturagrundlaget (lokale + kursister), regnet på taksterne som de gjaldt på
-- bookingens startdato — i skrivende stund, af triggeren, så tallet er det
-- rigtige også når taksterne senere ændres.

-- ---------------------------------------------------------------------------
-- 1) Rettigheder
-- ---------------------------------------------------------------------------
create or replace function public.can_invoice_bookings(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select (p_company_id = public.current_company_id()
          and public.has_any_role('manager', 'finance_manager'))
      or public.is_platform_admin()
$fn$;
create or replace function public.can_edit_invoice_drafts(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select (p_company_id = public.current_company_id()
          and public.has_any_role('manager', 'booking_manager', 'finance_manager'))
      or public.is_platform_admin()
$fn$;
grant execute on function public.can_invoice_bookings(uuid) to authenticated;
grant execute on function public.can_edit_invoice_drafts(uuid) to authenticated;

drop policy if exists invoice_drafts_select on public.invoice_drafts;
create policy invoice_drafts_select on public.invoice_drafts
  for select to authenticated
  using ((company_id = public.current_company_id()
          and public.has_any_role('manager', 'booking_manager', 'finance_manager'))
         or public.is_platform_admin());
drop policy if exists invoice_draft_lines_select on public.invoice_draft_lines;
create policy invoice_draft_lines_select on public.invoice_draft_lines
  for select to authenticated
  using ((company_id = public.current_company_id()
          and public.has_any_role('manager', 'booking_manager', 'finance_manager'))
         or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 2) Kreditnota — skema
-- ---------------------------------------------------------------------------
alter table public.invoice_drafts
  add column if not exists kind text not null default 'invoice' check (kind in ('invoice', 'credit')),
  add column if not exists credits_draft_id uuid references public.invoice_drafts(id) on delete set null,
  add column if not exists credited_by_draft_id uuid references public.invoice_drafts(id) on delete set null;
create index if not exists invoice_drafts_credits_idx on public.invoice_drafts (credits_draft_id) where credits_draft_id is not null;

-- Kreditnotaens linjer er negative. Fortegnet følger kladdens art og
-- håndhæves af vagten (et check-constraint kan ikke se over i kladden).
alter table public.invoice_draft_lines drop constraint if exists invoice_draft_lines_quantity_check;

create or replace function public.invoice_draft_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d record;
begin
  select status, kind into d from public.invoice_drafts
   where id = coalesce(new.draft_id, old.draft_id);
  if d.status = 'transferred' then
    raise exception 'draft_transferred' using errcode = 'P0001';
  end if;
  if tg_op <> 'DELETE' then
    if d.kind = 'credit' and new.quantity > 0 then
      raise exception 'credit_line_must_be_negative' using errcode = 'P0001';
    elsif d.kind <> 'credit' and new.quantity < 0 then
      raise exception 'invoice_line_must_be_positive' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$fn$;

create or replace function public.create_credit_note(p_draft_id uuid, p_lines jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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
                                            quantity, unit, unit_price, vat_code, sort_order)
    select company_id, v_id, booking_id, source, description,
           -quantity, unit, unit_price, vat_code, sort_order
    from public.invoice_draft_lines where draft_id = p_draft_id;
    get diagnostics v_lines = row_count;
  else
    -- Et udvalg: {line_id, quantity} — antallet må ikke overstige linjens eget.
    for l in
      select (e->>'line_id')::uuid as line_id, (e->>'quantity')::numeric as qty
      from jsonb_array_elements(p_lines) e
    loop
      select * into ln from public.invoice_draft_lines where id = l.line_id and draft_id = p_draft_id;
      if not found then raise exception 'line_not_on_draft' using errcode = 'P0001'; end if;
      v_qty := coalesce(l.qty, ln.quantity);
      if v_qty <= 0 or v_qty > ln.quantity then raise exception 'credit_quantity_invalid' using errcode = 'P0001'; end if;
      insert into public.invoice_draft_lines (company_id, draft_id, booking_id, source, description,
                                              quantity, unit, unit_price, vat_code, sort_order)
      values (ln.company_id, v_id, ln.booking_id, ln.source, ln.description,
              -v_qty, ln.unit, ln.unit_price, ln.vat_code, ln.sort_order);
      v_lines := v_lines + 1;
    end loop;
  end if;

  perform public.record_audit(d.company_id, 'invoice_draft.credit_created', 'invoice_draft',
    v_id::text, v_number, jsonb_build_object('credits', d.number, 'lines', v_lines,
                                              'partial', p_lines is not null));
  return jsonb_build_object('draft_id', v_id, 'number', v_number, 'lines', v_lines);
end;
$fn$;
revoke all on function public.create_credit_note(uuid, jsonb) from public;
grant execute on function public.create_credit_note(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Beløb i hændelsesloggen — hjælperen
-- ---------------------------------------------------------------------------
-- Lokale + kursister efter taksterne på startdatoen. Null når intet er prissat,
-- så "ingen takst" og "nul kroner" ikke bliver det samme tal.
create or replace function public.booking_basis_amount(
  p_company_id uuid, p_resource_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_participant_count integer, p_level_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_basis text;
  v_days integer;
  v_hours numeric;
  v_sum numeric := null;
  t record;
  v_qty numeric;
begin
  select coalesce(booking_day_basis, 'calendar') into v_basis from public.companies where id = p_company_id;
  v_days := public.booking_day_count(p_starts_at, p_ends_at, v_basis);
  v_hours := round(extract(epoch from (p_ends_at - p_starts_at)) / 3600.0, 2);
  for t in select * from public.booking_tariffs_on(p_company_id, p_resource_id, p_starts_at::date) loop
    v_qty := case t.unit when 'day' then v_days when 'hour' then v_hours when 'flat' then 1
                         when 'person' then coalesce(p_participant_count, 0)
                         when 'person_day' then coalesce(p_participant_count, 0) * v_days end;
    if coalesce(v_qty, 0) > 0 then v_sum := coalesce(v_sum, 0) + v_qty * t.amount; end if;
  end loop;
  if p_level_id is not null and coalesce(p_participant_count, 0) > 0 then
    for t in select * from public.booking_tariffs_on(p_company_id, p_level_id, p_starts_at::date) loop
      v_qty := case t.unit when 'person' then p_participant_count
                           when 'person_day' then p_participant_count * v_days
                           when 'flat' then 1 else null end;
      if coalesce(v_qty, 0) > 0 then v_sum := coalesce(v_sum, 0) + v_qty * t.amount; end if;
    end loop;
  end if;
  return v_sum;
end;
$fn$;
revoke all on function public.booking_basis_amount(uuid, uuid, timestamptz, timestamptz, integer, uuid) from public;

-- ---------------------------------------------------------------------------
-- 4) Funktionerne, genskrevet med de nye rettigheder og kreditnotaen
-- ---------------------------------------------------------------------------
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

  select default_currency, coalesce(booking_day_basis, 'calendar')
    into v_currency, v_basis
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
           c.vat_code as resource_vat, l.vat_code as level_vat
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

    v_days := public.booking_day_count(b.starts_at, b.ends_at, v_basis);
    v_hours := round(extract(epoch from (b.ends_at - b.starts_at)) / 3600.0, 2);
    v_priced := false;

    -- (a) Lokalet. Én linje pr. takst på ressourcen, fordi et lokale godt kan
    --     have både en dagspris og en pris pr. kursist (C-05/C-07).
    for t in
      select * from public.booking_tariffs_on(p_company_id, b.resource_id, b.starts_at::date)
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
        unit_price, vat_code, sort_order)
      values (
        p_company_id, v_draft_id, b.id, 'resource',
        b.resource_name || ' ' || to_char(b.starts_at, 'DD.MM.YYYY')
          || case when b.ends_at::date > b.starts_at::date
                  then '–' || to_char(b.ends_at, 'DD.MM.YYYY') else '' end,
        v_qty, t.unit, t.amount, b.resource_vat, v_sort);
      v_sort := v_sort + 1;
      v_lines := v_lines + 1;
      v_priced := true;
    end loop;

    -- (b) Kursistniveauet (C-07): differentieret takst pr. kursist.
    if b.participant_level_id is not null and coalesce(b.participant_count, 0) > 0 then
      for t in
        select * from public.booking_tariffs_on(p_company_id, b.participant_level_id, b.starts_at::date)
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
          unit_price, vat_code, sort_order)
        values (
          p_company_id, v_draft_id, b.id, 'participants',
          b.level_name || ' (' || b.participant_count::text || ')',
          v_qty, t.unit, t.amount, b.level_vat, v_sort);
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
      unit_price, vat_code, sort_order)
    select
      p_company_id, v_draft_id, b.id, 'service', s.name,
      case when sl.price_mode = 'total' then 1 else sl.quantity end,
      'service', sl.unit_price, s.vat_code,
      v_sort + row_number() over (order by s.name)
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
    v_from := least(v_from, b.starts_at::date);
    v_to := greatest(v_to, b.ends_at::date);
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

CREATE OR REPLACE FUNCTION public.cancel_invoice_draft(p_draft_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record;
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  if not public.can_edit_invoice_drafts(d.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if d.status = 'transferred' then
    raise exception 'draft_transferred' using errcode = 'P0001';
  end if;

  update public.bookings set invoice_draft_id = null where invoice_draft_id = p_draft_id;
  update public.invoice_drafts set status = 'cancelled' where id = p_draft_id;

  perform public.record_audit(d.company_id, 'invoice_draft.cancelled', 'invoice_draft',
    p_draft_id::text, d.number);
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_invoice_draft_line(p_draft_id uuid, p_description text, p_quantity numeric, p_unit_price numeric, p_vat_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record;
  v_id uuid;
  v_sort integer;
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  if not public.can_edit_invoice_drafts(d.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if d.status in ('transferred', 'cancelled') then
    raise exception 'draft_closed' using errcode = 'P0001';
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_sort
    from public.invoice_draft_lines where draft_id = p_draft_id;

  insert into public.invoice_draft_lines (
    company_id, draft_id, source, description, quantity, unit_price, vat_code, sort_order)
  values (
    d.company_id, p_draft_id, 'manual', btrim(coalesce(p_description, '')),
    coalesce(p_quantity, 0), coalesce(p_unit_price, 0),
    nullif(btrim(coalesce(p_vat_code, '')), ''), v_sort)
  returning id into v_id;

  perform public.record_audit(d.company_id, 'invoice_draft.line_added', 'invoice_draft',
    p_draft_id::text, d.number,
    jsonb_build_object('quantity', coalesce(p_quantity, 0), 'unit_price', coalesce(p_unit_price, 0)));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_invoice_draft_line(p_line_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l record;
  d record;
begin
  select * into l from public.invoice_draft_lines where id = p_line_id;
  if not found then
    raise exception 'line_not_found' using errcode = 'P0002';
  end if;
  select * into d from public.invoice_drafts where id = l.draft_id;
  if not public.can_edit_invoice_drafts(d.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if d.status in ('transferred', 'cancelled') then
    raise exception 'draft_closed' using errcode = 'P0001';
  end if;

  delete from public.invoice_draft_lines where id = p_line_id;

  perform public.record_audit(d.company_id, 'invoice_draft.line_removed', 'invoice_draft',
    l.draft_id::text, d.number,
    jsonb_build_object('source', l.source, 'amount', l.amount));
end;
$function$;

CREATE OR REPLACE FUNCTION public.regenerate_invoice_draft(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record;
  v_ids uuid[];
  v_result jsonb;
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  if not public.can_edit_invoice_drafts(d.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if d.status in ('transferred', 'cancelled') then
    raise exception 'draft_closed' using errcode = 'P0001';
  end if;

  -- Annullerede bookinger tages ikke med igen — det ER ofte grunden til, at
  -- kladden blev forældet (A-07: "udgår af fakturagrundlaget").
  select coalesce(array_agg(b.id), '{}'::uuid[]) into v_ids
  from public.bookings b
  where b.invoice_draft_id = p_draft_id and b.status = 'booked';

  perform public.cancel_invoice_draft(p_draft_id);

  if array_length(v_ids, 1) is null then
    return jsonb_build_object('draft_id', null, 'number', null, 'lines', 0,
                              'included', '[]'::jsonb, 'skipped', '[]'::jsonb,
                              'replaced', d.number);
  end if;

  v_result := public.generate_invoice_draft(d.company_id, v_ids, d.note);
  if v_result->>'draft_id' is not null then
    update public.invoice_drafts
       set bill_to_name = d.bill_to_name, bill_to_ref = d.bill_to_ref
     where id = (v_result->>'draft_id')::uuid;
    perform public.record_audit(d.company_id, 'invoice_draft.regenerated', 'invoice_draft',
      v_result->>'draft_id', v_result->>'number',
      jsonb_build_object('replaced', d.number, 'reason', d.stale_reason));
  end if;
  return v_result || jsonb_build_object('replaced', d.number);
end;
$function$;

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
  if not public.can_edit_invoice_drafts(p_company_id) then
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
$function$;

CREATE OR REPLACE FUNCTION public.approve_invoice_draft(p_draft_id uuid, p_approve boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record;
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  if not public.can_invoice_bookings(d.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if d.status = 'transferred' then
    raise exception 'draft_transferred' using errcode = 'P0001';
  end if;
  if d.status = 'cancelled' then
    raise exception 'draft_cancelled' using errcode = 'P0001';
  end if;
  if p_approve and d.stale_at is not null then
    raise exception 'draft_stale' using errcode = 'P0001';
  end if;

  update public.invoice_drafts
     set status = case when p_approve then 'approved' else 'draft' end,
         approved_at = case when p_approve then now() else null end,
         approved_by = case when p_approve then auth.uid() else null end
   where id = p_draft_id;

  perform public.record_audit(d.company_id,
    case when p_approve then 'invoice_draft.approved' else 'invoice_draft.approval_cleared' end,
    'invoice_draft', p_draft_id::text, d.number);
end;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_invoice_draft(p_draft_id uuid, p_invoice_no text, p_system text DEFAULT 'manual'::text, p_external_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d record;
  v_no text := nullif(btrim(coalesce(p_invoice_no, '')), '');
  v_sys text := nullif(btrim(coalesce(p_system, '')), '');
  b record;
  v_orig numeric;
  v_cred numeric;
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  if not public.can_invoice_bookings(d.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if d.status = 'cancelled' then
    raise exception 'draft_cancelled' using errcode = 'P0001';
  end if;
  if d.status = 'transferred' then
    raise exception 'draft_transferred' using errcode = 'P0001';
  end if;
  if d.stale_at is not null then
    raise exception 'draft_stale' using errcode = 'P0001';
  end if;
  if v_no is null then
    raise exception 'invoice_no_required' using errcode = 'P0001';
  end if;

  update public.invoice_drafts
     set status = 'transferred',
         invoice_no = v_no,
         external_system = coalesce(v_sys, 'manual'),
         external_id = nullif(btrim(coalesce(p_external_id, '')), ''),
         transferred_at = now(),
         transferred_by = auth.uid()
   where id = p_draft_id;

  if d.kind = 'credit' then
    -- Kreditnota (C-09). Er HELE den oprindelige faktura krediteret, er
    -- bookingerne ikke længere fakturerede: låsen løftes, og de kan rettes og
    -- faktureres igen. En delvis kreditnota rører ikke låsen — fakturaen står
    -- stadig, blot med et fradrag.
    select coalesce(sum(amount), 0) into v_orig from public.invoice_draft_lines where draft_id = d.credits_draft_id;
    select coalesce(sum(amount), 0) into v_cred from public.invoice_draft_lines where draft_id = p_draft_id;
    update public.invoice_drafts set credited_by_draft_id = p_draft_id where id = d.credits_draft_id;
    if v_orig + v_cred = 0 then
      for b in select distinct booking_id from public.invoice_draft_lines
                where draft_id = d.credits_draft_id and booking_id is not null
      loop
        perform public.set_booking_invoiced(b.booking_id, false);
        update public.bookings set invoice_draft_id = null where id = b.booking_id;
      end loop;
    end if;
  else
    for b in select distinct booking_id from public.invoice_draft_lines
              where draft_id = p_draft_id and booking_id is not null
    loop
      perform public.set_booking_invoiced(b.booking_id, true);
    end loop;
  end if;

  perform public.record_audit(d.company_id, 'invoice_draft.transferred', 'invoice_draft',
    p_draft_id::text, d.number,
    jsonb_build_object('system', coalesce(v_sys, 'manual')));
end;
$function$;

CREATE OR REPLACE FUNCTION public.audit_bookings_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_detail jsonb := '{}'::jsonb;
  v_type text;
begin
  if tg_op = 'INSERT' then
    insert into public.booking_events
      (booking_id, company_id, event_type, actor_user_id, detail)
    values
      (new.id, new.company_id, 'created', auth.uid(),
       jsonb_build_object(
         'resource_id', new.resource_id,
         'employee_id', new.employee_id,
         'starts_at', new.starts_at,
         'ends_at', new.ends_at,
         'all_day', new.all_day,
         'participant_count', new.participant_count,
         'participant_level_id', new.participant_level_id,
         'has_title', new.title is not null));
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Opbevaringspurgen logger sin egen optælling; her ville vi kun tilføje
    -- én række pr. slettet booking i den log, purgen netop rydder op i.
    if coalesce(current_setting('operia.retention_purge', true), '') = 'on' then
      return old;
    end if;
    perform public.record_audit(
      old.company_id, 'booking.deleted', 'booking', old.id::text, null,
      jsonb_build_object(
        'resource_id', old.resource_id,
        'starts_at', old.starts_at,
        'ends_at', old.ends_at,
        'status', old.status));
    return old;
  end if;

  -- UPDATE: kun de felter der FAKTISK ændrede sig kommer med. At parret er der,
  -- betyder at værdien flyttede sig — det er dét, notifikationernes
  -- movesSomething() læser, og det gør loggen læsbar for et menneske.
  if new.resource_id is distinct from old.resource_id then
    v_detail := v_detail || jsonb_build_object(
      'from_resource_id', old.resource_id, 'to_resource_id', new.resource_id);
  end if;
  if new.employee_id is distinct from old.employee_id then
    v_detail := v_detail || jsonb_build_object(
      'from_employee_id', old.employee_id, 'to_employee_id', new.employee_id);
  end if;
  if new.starts_at is distinct from old.starts_at then
    v_detail := v_detail || jsonb_build_object(
      'from_starts_at', old.starts_at, 'to_starts_at', new.starts_at);
  end if;
  if new.ends_at is distinct from old.ends_at then
    v_detail := v_detail || jsonb_build_object(
      'from_ends_at', old.ends_at, 'to_ends_at', new.ends_at);
  end if;
  if new.all_day is distinct from old.all_day then
    v_detail := v_detail || jsonb_build_object(
      'from_all_day', old.all_day, 'to_all_day', new.all_day);
  end if;
  if new.participant_count is distinct from old.participant_count then
    v_detail := v_detail || jsonb_build_object(
      'from_participant_count', old.participant_count,
      'to_participant_count', new.participant_count);
  end if;
  if new.participant_level_id is distinct from old.participant_level_id then
    v_detail := v_detail || jsonb_build_object(
      'from_participant_level_id', old.participant_level_id,
      'to_participant_level_id', new.participant_level_id);
  end if;
  if new.status is distinct from old.status then
    v_detail := v_detail || jsonb_build_object(
      'from_status', old.status, 'to_status', new.status);
  end if;
  if new.invoiced_at is distinct from old.invoiced_at then
    v_detail := v_detail || jsonb_build_object(
      'from_invoiced_at', old.invoiced_at, 'to_invoiced_at', new.invoiced_at);
  end if;
  -- Fritekst: kun kendsgerningen, aldrig indholdet (se hovedkommentaren).
  if new.title is distinct from old.title then
    v_detail := v_detail || jsonb_build_object('title_changed', true);
  end if;
  if new.cancellation_reason is distinct from old.cancellation_reason then
    v_detail := v_detail || jsonb_build_object('reason_changed', true);
  end if;

  -- Et gem uden ændringer er ikke en hændelse.
  if v_detail = '{}'::jsonb then
    return new;
  end if;

  -- Beløbskonsekvensen (D-04): hvad ændringen betød for fakturagrundlaget,
  -- regnet på lokale- og kursisttakster som de gjaldt på bookingens startdato.
  -- Tilkøb har deres egne, prissatte hændelser. Skrives KUN når noget, der
  -- indgår i regnestykket, er ændret — ellers ville hver formålsrettelse bære
  -- to ens tal.
  if new.resource_id is distinct from old.resource_id
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.participant_count is distinct from old.participant_count
     or new.participant_level_id is distinct from old.participant_level_id
     or (old.status = 'booked' and new.status = 'cancelled') then
    v_detail := v_detail || jsonb_strip_nulls(jsonb_build_object(
      'amount_from', public.booking_basis_amount(old.company_id, old.resource_id, old.starts_at, old.ends_at,
                                                 old.participant_count, old.participant_level_id),
      'amount_to', case when new.status = 'cancelled' then 0
                        else public.booking_basis_amount(new.company_id, new.resource_id, new.starts_at, new.ends_at,
                                                         new.participant_count, new.participant_level_id) end));
  end if;

  v_type := case
    when old.status = 'booked' and new.status = 'cancelled' then 'cancelled'
    when old.invoiced_at is null and new.invoiced_at is not null then 'invoiced'
    when old.invoiced_at is not null and new.invoiced_at is null then 'invoice_cleared'
    else 'updated'
  end;

  -- Kontekst på de hændelser, et menneske slår op i Logs.
  -- Ressource OG tidsrum: den uforanderlige audit_log-spejling skal kunne
  -- fortælle hvilken tid bookingen optog, også efter at bookingen selv og
  -- dens booking_events er ryddet af opbevaringspolitikken.
  if v_type <> 'updated' then
    v_detail := v_detail || jsonb_build_object(
      'resource_id', new.resource_id,
      'starts_at', new.starts_at,
      'ends_at', new.ends_at,
      'all_day', new.all_day);
  end if;
  if v_type = 'cancelled' then
    v_detail := v_detail || jsonb_build_object(
      'has_reason', new.cancellation_reason is not null);
  end if;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (new.id, new.company_id, v_type, auth.uid(), v_detail);

  return new;
end;
$function$;

-- Faktureringsmarkeringen kaldes af overførslen; økonomirollen skal kunne sætte den.
CREATE OR REPLACE FUNCTION public.set_booking_invoiced(p_booking_id uuid, p_invoiced boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not (public.can_manage_bookings(v_booking.company_id) or public.can_invoice_bookings(v_booking.company_id)) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if coalesce(p_invoiced, true) then
    if v_booking.invoiced_at is not null then
      raise exception 'booking_invoiced' using errcode = 'P0001';
    end if;
    if v_booking.status <> 'booked' then
      raise exception 'booking_already_cancelled' using errcode = 'P0001';
    end if;
    if v_booking.ends_at > now() then
      raise exception 'booking_not_completed' using errcode = 'P0001';
    end if;

    update public.bookings
       set invoiced_at = now(),
           invoiced_by = auth.uid()
     where id = v_booking.id;

  else
    if v_booking.invoiced_at is null then
      raise exception 'booking_not_invoiced' using errcode = 'P0001';
    end if;

    update public.bookings
       set invoiced_at = null,
           invoiced_by = null
     where id = v_booking.id;

  end if;
end;
$function$;

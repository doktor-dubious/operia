-- Rettelser efter code review 2026-09-14 (fakturering, import, Dalux, log):
--
--   1) booking_day_count talte i sessionens tidszone (UTC under PostgREST) og
--      inklusivt på et halvåbent interval: en heldagsbooking blev to dage på
--      en dagstakst. Nu tælles KALENDERDAGE i virksomhedens tidszone, og
--      sluttidspunktet er eksklusivt. Kalderne (booking_basis_amount og
--      generate_invoice_draft) sender virksomhedens tidszone med.
--   2) generate_invoice_draft tog bookinger, der ikke var afholdt endnu, med —
--      og transfer_invoice_draft afviste dem bagefter (booking_not_completed),
--      EFTER kladden var oprettet i e-conomic. De springes nu over med
--      årsagen 'not_completed', så det står i svaret.
--   3) create_credit_note: et eksplicit null-antal på en linje blev til hele
--      linjen (coalesce). Nu er et angivet, men tomt, antal en fejl.
--   4) import_bookings: `record`-variablen v_existing blev sat til null og
--      derefter læst (v_existing.id) → 'record is not assigned yet' for hver
--      række uden external_ref. Nu %rowtype. Talfelterne castes inde i
--      fejlhåndteringen ('bad_value'), og importloggen (import_runs) skrives
--      HER — den klientside indsættelse blev afvist af RLS for booking_manager.
--   5) audit_category mistede 'invoice%' → 'booking' i Dalux-migrationen.
--      Begge grene, og den lagrede kolonne genberegnes.
--   6) invoice_draft_lines_guard blokerede kaskadesletningen fra companies
--      for linjer på overførte kladder. Slettes virksomheden, må linjerne gå.
--   7) run_retention_purge stoppede for ALLE kunder ved første booking, der
--      nogensinde havde ligget på en kladde (FK 'restrict'). Bookinger på
--      annullerede kladder ryddes (linjerne med); bookinger på åbne/overførte
--      kladder er bilag og bliver stående.

-- ---------------------------------------------------------------------------
-- 1) Dage i virksomhedens tidszone, halvåbent interval
-- ---------------------------------------------------------------------------
-- Den gamle signatur fjernes: to overbelastninger ville gøre kaldet med tre
-- argumenter tvetydigt.
drop function if exists public.booking_day_count(timestamptz, timestamptz, text);

create or replace function public.booking_day_count(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_basis text default 'calendar',
  p_tz text default 'Europe/Copenhagen'
)
returns integer
language sql
stable
as $fn$
  with d as (
    select
      (p_starts_at at time zone coalesce(nullif(p_tz, ''), 'Europe/Copenhagen'))::date as d0,
      -- Sidste dag, bookingen rører: dagen for det sidste øjeblik FØR slut.
      -- 00:00 → 00:00 næste dag er én dag; 22:00 → 02:00 er to.
      greatest(
        (p_starts_at at time zone coalesce(nullif(p_tz, ''), 'Europe/Copenhagen'))::date,
        ((p_ends_at - interval '1 microsecond') at time zone coalesce(nullif(p_tz, ''), 'Europe/Copenhagen'))::date
      ) as d1
  )
  select greatest(
    case
      when coalesce(p_basis, 'calendar') = 'weekday' then (
        select count(*)::int
        from generate_series(d.d0, d.d1, interval '1 day') x
        where extract(isodow from x) between 1 and 5
      )
      else (d.d1 - d.d0) + 1
    end,
    1
  )
  from d
$fn$;

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
  v_tz text;
  v_days integer;
  v_hours numeric;
  v_sum numeric := null;
  t record;
  v_qty numeric;
begin
  select coalesce(booking_day_basis, 'calendar'), coalesce(timezone, 'Europe/Copenhagen')
    into v_basis, v_tz from public.companies where id = p_company_id;
  v_days := public.booking_day_count(p_starts_at, p_ends_at, v_basis, v_tz);
  v_hours := round(extract(epoch from (p_ends_at - p_starts_at)) / 3600.0, 2);
  for t in select * from public.booking_tariffs_on(p_company_id, p_resource_id, (p_starts_at at time zone v_tz)::date) loop
    v_qty := case t.unit when 'day' then v_days when 'hour' then v_hours when 'flat' then 1
                         when 'person' then coalesce(p_participant_count, 0)
                         when 'person_day' then coalesce(p_participant_count, 0) * v_days end;
    if coalesce(v_qty, 0) > 0 then v_sum := coalesce(v_sum, 0) + v_qty * t.amount; end if;
  end loop;
  if p_level_id is not null and coalesce(p_participant_count, 0) > 0 then
    for t in select * from public.booking_tariffs_on(p_company_id, p_level_id, (p_starts_at at time zone v_tz)::date) loop
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
-- 2) Generatoren: tidszone med, og kun afholdte bookinger
-- ---------------------------------------------------------------------------
create or replace function public.generate_invoice_draft(p_company_id uuid, p_booking_ids uuid[], p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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
        unit_price, vat_code, sort_order)
      values (
        p_company_id, v_draft_id, b.id, 'resource',
        b.resource_name || ' ' || to_char(b.starts_at at time zone v_tz, 'DD.MM.YYYY')
          || case when ((b.ends_at - interval '1 microsecond') at time zone v_tz)::date > (b.starts_at at time zone v_tz)::date
                  then '–' || to_char((b.ends_at - interval '1 microsecond') at time zone v_tz, 'DD.MM.YYYY') else '' end,
        v_qty, t.unit, t.amount, b.resource_vat, v_sort);
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
$fn$;

-- ---------------------------------------------------------------------------
-- 3) Kreditnota: et angivet, tomt antal er en fejl — ikke hele linjen
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4) Importen
-- ---------------------------------------------------------------------------
-- Ny parameter (filnavnet til importloggen) ⇒ den gamle signatur fjernes, så
-- PostgREST ikke ser to kandidater (PGRST203).
drop function if exists public.import_bookings(uuid, jsonb, boolean);

create or replace function public.import_bookings(
  p_company_id uuid,
  p_rows jsonb,
  p_apply boolean default false,
  p_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r jsonb;
  i integer := 0;
  v_ref text; v_res_txt text; v_emp_txt text; v_lvl_txt text; v_title text;
  v_starts timestamptz; v_ends timestamptz; v_all_day boolean; v_count integer;
  v_res uuid; v_emp uuid; v_lvl uuid;
  -- %rowtype, ikke `record`: en record-variabel, der er sat til null, kan
  -- ikke læses (SQLSTATE 55000) — og den læses i overlap-kontrollen for
  -- hver række uden external_ref.
  v_existing public.bookings%rowtype;
  v_action text; v_reason text; v_id uuid;
  v_created int := 0; v_updated int := 0; v_unchanged int := 0; v_skipped int := 0;
  v_out jsonb := '[]'::jsonb;
  v_seen_refs text[] := '{}';
  v_tz text;
  v_errors jsonb;
begin
  if not public.can_manage_bookings(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_required' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'too_many_rows' using errcode = 'P0001';
  end if;
  -- Tidspunkterne i filen er VÆGUR-tid i kundens tidszone — ikke browserens.
  -- Den, der importerer, kan sidde hvor som helst; lokalet står i Danmark.
  select coalesce(timezone, 'Europe/Copenhagen') into v_tz from public.companies where id = p_company_id;

  -- Rækker accepteret i DENNE kørsel, til overlap inden for filen.
  create temporary table if not exists _import_accepted (
    resource_id uuid, starts_at timestamptz, ends_at timestamptz, ref text
  ) on commit drop;
  -- 'delete' uden where afvises af safeupdate på klientrollen; truncate er ok.
  truncate _import_accepted;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_action := null; v_reason := null; v_id := null; v_res := null; v_emp := null; v_lvl := null;
    v_existing := null;
    v_ref := nullif(btrim(coalesce(r->>'external_ref', '')), '');
    v_res_txt := nullif(btrim(coalesce(r->>'resource', '')), '');
    v_emp_txt := nullif(btrim(coalesce(r->>'employee', '')), '');
    v_lvl_txt := nullif(btrim(coalesce(r->>'participant_level', '')), '');
    v_title := nullif(btrim(coalesce(r->>'title', '')), '');
    -- Et ulæseligt tal eller ja/nej må ikke vælte hele kørslen — det er én
    -- rækkes fejl, og den skal stå på rækken.
    begin
      v_all_day := coalesce((r->>'all_day')::boolean, false);
      v_count := nullif(r->>'participant_count', '')::integer;
    exception when others then
      v_all_day := false; v_count := null; v_reason := 'bad_value';
    end;
    begin
      v_starts := (r->>'starts_at')::timestamp at time zone v_tz;
      v_ends := (r->>'ends_at')::timestamp at time zone v_tz;
    exception when others then
      v_starts := null; v_ends := null;
    end;

    -- 1) Opslag. Ressourcen på navn (foldet) eller Dalux-id; medarbejderen på
    --    nummer, e-mail, initialer eller navn — i den rækkefølge, fordi
    --    nummeret er entydigt og navnet ikke er.
    if v_res_txt is not null then
      select id into v_res from public.booking_resources
       where company_id = p_company_id and is_active
         and (dalux_room_id = v_res_txt or public.fold_name(name) = public.fold_name(v_res_txt))
       order by (dalux_room_id = v_res_txt) desc limit 1;
    end if;
    if v_emp_txt is not null then
      select id into v_emp from public.employees
       where company_id = p_company_id and is_active
         and (employee_no = v_emp_txt or lower(email) = lower(v_emp_txt)
              or initials_folded = public.fold_name(v_emp_txt)
              or full_name_folded = public.fold_name(v_emp_txt))
       order by (employee_no = v_emp_txt) desc, (lower(email) = lower(v_emp_txt)) desc limit 1;
    end if;
    if v_lvl_txt is not null then
      select id into v_lvl from public.booking_participant_levels
       where company_id = p_company_id and public.fold_name(name) = public.fold_name(v_lvl_txt) limit 1;
    end if;

    -- 2) Kontroller, i den rækkefølge en læser forstår dem.
    if v_reason is not null then null;
    elsif v_starts is null or v_ends is null then v_reason := 'bad_time';
    elsif v_ends <= v_starts then v_reason := 'bad_interval';
    elsif v_res_txt is null then v_reason := 'resource_missing';
    elsif v_res is null then v_reason := 'resource_unknown';
    -- En booking har altid en medarbejder (create_booking kræver det): den er
    -- den, lokalet er booket til, og den, bekræftelsen sendes til (A-04).
    elsif v_emp_txt is null then v_reason := 'employee_missing';
    elsif v_emp is null then v_reason := 'employee_unknown';
    elsif v_lvl_txt is not null and v_lvl is null then v_reason := 'level_unknown';
    elsif v_ref is not null and v_ref = any(v_seen_refs) then v_reason := 'duplicate_ref_in_file';
    end if;

    -- 3) Findes den allerede (på external_ref)?
    if v_reason is null and v_ref is not null then
      select * into v_existing from public.bookings
       where company_id = p_company_id and external_ref = v_ref;
      if found then
        if v_existing.invoiced_at is not null then v_reason := 'invoiced_locked';
        elsif v_existing.status = 'cancelled' then v_reason := 'cancelled_locked';
        elsif v_existing.resource_id = v_res
          and v_existing.employee_id is not distinct from v_emp
          and v_existing.starts_at = v_starts and v_existing.ends_at = v_ends
          and v_existing.all_day = v_all_day
          and v_existing.title is not distinct from v_title
          and v_existing.participant_count is not distinct from v_count
          and v_existing.participant_level_id is not distinct from v_lvl then
          v_action := 'unchanged';
        else
          v_action := 'update';
        end if;
      end if;
    end if;
    if v_reason is null and v_action is null then v_action := 'create'; end if;

    -- 4) Overlap: mod basen (uden bookingen selv) og mod filens egne rækker.
    if v_reason is null and v_action in ('create', 'update') then
      if exists (
        select 1 from public.bookings b
        where b.company_id = p_company_id and b.resource_id = v_res and b.status = 'booked'
          and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_starts, v_ends, '[)')
          and (v_existing.id is null or b.id <> v_existing.id)
      ) or exists (
        select 1 from _import_accepted a
        where a.resource_id = v_res and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(v_starts, v_ends, '[)')
      ) then
        v_reason := 'overlap';
      end if;
    end if;

    -- 5) Anvend — gennem de samme RPC'er som brugerfladen.
    if v_reason is null and p_apply then
      begin
        if v_action = 'create' then
          v_id := public.create_booking(v_res, v_emp, v_starts, v_ends, v_title, v_all_day, v_count, v_lvl);
          if v_ref is not null then
            update public.bookings set external_ref = v_ref where id = v_id;
          end if;
        elsif v_action = 'update' then
          perform public.update_booking(v_existing.id, v_res, v_emp, v_starts, v_ends, v_title, v_all_day, v_count, v_lvl);
          v_id := v_existing.id;
        else
          v_id := v_existing.id;
        end if;
      exception
        when exclusion_violation then v_reason := 'overlap';
        when others then
          -- RPC'ernes egne koder (booking_retro_not_allowed, employee_inactive, …)
          -- videregives som de er; en ukendt fejl bliver 'internal'.
          v_reason := case when sqlerrm ~ '^[a-z_]+$' then sqlerrm else 'internal' end;
      end;
    end if;

    if v_reason is not null then
      v_skipped := v_skipped + 1;
      v_action := 'skip';
    else
      if v_action = 'create' then v_created := v_created + 1;
      elsif v_action = 'update' then v_updated := v_updated + 1;
      else v_unchanged := v_unchanged + 1; end if;
      if v_action <> 'unchanged' then
        insert into _import_accepted values (v_res, v_starts, v_ends, v_ref);
      end if;
      if v_ref is not null then v_seen_refs := v_seen_refs || v_ref; end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'row', i, 'action', v_action, 'reason', v_reason, 'booking_id', v_id,
      'external_ref', v_ref,
      'resource', (select name from public.booking_resources where id = v_res),
      'employee', (select full_name from public.employees where id = v_emp),
      'starts_at', v_starts, 'ends_at', v_ends);
  end loop;

  if p_apply then
    perform public.record_audit(p_company_id, 'booking.imported', 'booking', p_company_id::text,
      null, jsonb_build_object('rows', i, 'created', v_created, 'updated', v_updated,
                               'unchanged', v_unchanged, 'skipped', v_skipped));

    -- Den fælles importlog (Import → Log). Skrives her, med funktionens
    -- rettigheder: booking_manager har ikke selv indsæt på import_runs.
    select coalesce(jsonb_agg(jsonb_build_object('row', x->'row', 'reason', x->'reason')), '[]'::jsonb)
      into v_errors from jsonb_array_elements(v_out) x where x->>'action' = 'skip';
    insert into public.import_runs (
      company_id, kind, file_name, status, rows_total, created_count, updated_count,
      unchanged_count, rejected_count, errors, created_by, created_by_email)
    values (
      p_company_id, 'bookings_csv', left(nullif(btrim(coalesce(p_file_name, '')), ''), 200),
      case when i > 0 and v_skipped = i then 'rejected' else 'applied' end,
      i, v_created, v_updated, v_unchanged, v_skipped, v_errors,
      auth.uid(), (select email from auth.users where id = auth.uid()));
  end if;

  return jsonb_build_object(
    'applied', p_apply, 'rows', i,
    'created', v_created, 'updated', v_updated, 'unchanged', v_unchanged, 'skipped', v_skipped,
    'results', v_out);
end;
$fn$;
revoke all on function public.import_bookings(uuid, jsonb, boolean, text) from public;
grant execute on function public.import_bookings(uuid, jsonb, boolean, text) to authenticated;

-- Bookingimportens kørsler skal kunne læses af den, der kørte dem.
drop policy if exists import_runs_select on public.import_runs;
create policy import_runs_select on public.import_runs
  for select to authenticated
  using (
    (
      company_id = public.current_company_id()
      and (
        public.has_any_role('manager', 'data_manager', 'asset_manager', 'inventory_manager')
        or (kind = 'bookings_csv' and public.has_any_role('booking_manager'))
      )
    )
    or public.is_platform_admin()
  );

-- ---------------------------------------------------------------------------
-- 5) audit_category: begge grene — og den lagrede kolonne genberegnes
-- ---------------------------------------------------------------------------
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $fn$
  select case
    when split_part(coalesce(p_action, ''), '.', 1) like 'booking%' then 'booking'
    when split_part(coalesce(p_action, ''), '.', 1) like 'invoice%' then 'booking'
    else case split_part(coalesce(p_action, ''), '.', 1)
      when 'parcel'         then 'parcels'
      when 'parcel_flow'    then 'parcels'
      when 'employee'       then 'directory'
      when 'department'     then 'directory'
      when 'location'       then 'config'
      when 'handling_class' then 'config'
      when 'carrier'        then 'config'
      when 'general'        then 'config'
      when 'shipping'       then 'shipping'
      when 'agreement'      then 'shipping'
      when 'asset'          then 'assets'
      when 'asset_category' then 'assets'
      when 'asset_location' then 'assets'
      when 'asset_flow'     then 'assets'
      when 'assets'         then 'assets'
      when 'inventory_item' then 'inventory'
      when 'locker'         then 'lockers'
      when 'user'           then 'access'
      when 'auth'           then 'access'
      when 'product'        then 'entitlements'
      when 'feature'        then 'entitlements'
      when 'template'       then 'branding'
      when 'language'       then 'branding'
      when 'currency'       then 'branding'
      when 'appearance'     then 'branding'
      when 'product_text'   then 'branding'
      when 'home'           then 'branding'
      when 'handheld'       then 'branding'
      when 'maps'           then 'maps'
      when 'route'          then 'maps'
      when 'import'         then 'imports'
      when 'import_config'  then 'imports'
      when 'data_transfer'  then 'imports'
      when 'dalux'          then 'imports'
      when 'log_drain'      then 'log'
      when 'retention'      then 'log'
      when 'ai'             then 'ai'
      when 'privacy'        then 'compliance'
      when 'accounting'     then 'accounting'
      when 'email'          then 'email'
      else 'other'
    end
  end
$fn$;

-- Samme værn som de tidligere taksonomi-migrationer: rækkerne, der blev
-- fejlkategoriseret imens, får den rigtige kategori.
alter table public.audit_log disable trigger audit_log_immutable;
update public.audit_log set action = action
  where category is distinct from public.audit_category(action);
alter table public.audit_log enable trigger audit_log_immutable;

-- ---------------------------------------------------------------------------
-- 6) Linjeværnet: kaskaden fra companies må gå igennem
-- ---------------------------------------------------------------------------
create or replace function public.invoice_draft_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status text;
begin
  -- Slettes virksomheden, kaskaderer companies → invoice_draft_lines direkte,
  -- før kladden er væk. Er virksomheden allerede væk, er linjen det også.
  if tg_op = 'DELETE' and not exists (select 1 from public.companies where id = old.company_id) then
    return old;
  end if;
  select status into v_status from public.invoice_drafts
   where id = coalesce(new.draft_id, old.draft_id);
  if v_status = 'transferred' then
    raise exception 'draft_transferred' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 7) Opbevaringspurgen og fakturagrundlaget
-- ---------------------------------------------------------------------------
create or replace function public.run_retention_purge()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  emp record;
  d integer;
  n bigint;
  v_platform_audit integer;
  v_ids uuid[];
begin
  -- Transaktionslokal (is_local => true): åbner block_mutation for denne purge.
  perform set_config('operia.retention_purge', 'on', true);

  select audit_retention_days into v_platform_audit from platform_settings where id;

  -- Platform-egne revisionsrækker (company_id is null) hører ingen kunde til og
  -- følger derfor platformens eget vindue.
  if v_platform_audit is not null then
    delete from audit_log
      where company_id is null
        and created_at < now() - make_interval(days => v_platform_audit);
    get diagnostics n = row_count;
    if n > 0 then
      perform record_audit(null, 'retention.purged', 'audit_log', 'platform', n::text,
        jsonb_build_object('table', 'audit_log', 'scope', 'platform', 'deleted', n,
          'retention_days', v_platform_audit));
    end if;

    -- Rækker for en SLETTET virksomhed: audit_log har bevidst ingen FK til
    -- companies (loggen skal overleve sletning af virksomheden), så de matcher
    -- hverken grenen ovenfor eller kundeløkken nedenfor. Der findes ikke
    -- længere nogen dataansvarlig til at vælge et vindue, så platformens
    -- gælder.
    delete from audit_log a
      where a.company_id is not null
        and not exists (select 1 from companies co where co.id = a.company_id)
        and a.created_at < now() - make_interval(days => v_platform_audit);
    get diagnostics n = row_count;
    if n > 0 then
      perform record_audit(null, 'retention.purged', 'audit_log', 'orphaned', n::text,
        jsonb_build_object('table', 'audit_log', 'scope', 'deleted_companies', 'deleted', n,
          'retention_days', v_platform_audit));
    end if;
  end if;

  for c in select id from companies loop
    -- --- Revisionslog ---------------------------------------------------
    d := retention_days(c.id, 'audit');
    if d is not null then
      delete from audit_log
        where company_id = c.id and created_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'audit_log', c.id::text, null,
          jsonb_build_object('table', 'audit_log', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Import ----------------------------------------------------------
    d := retention_days(c.id, 'imports');
    if d is not null then
      delete from import_runs
        where company_id = c.id and created_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'import_run', c.id::text, null,
          jsonb_build_object('table', 'import_runs', 'deleted', n, 'retention_days', d));
      end if;

      delete from inbound_files
        where company_id = c.id and received_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'inbound_file', c.id::text, null,
          jsonb_build_object('table', 'inbound_files', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Beskedlog --------------------------------------------------------
    -- KUN beskeder hvis pakke/udlån er lukket eller væk: for en åben pakke er
    -- rækkerne dispatcherens dedup- og tæller-tilstand (sentSet/failedCount i
    -- dispatch-parcel-notifications) — slettes de, sendes hele
    -- påmindelsesstigen forfra. Pakke-purgen nedenfor har samme lukket-filter.
    d := retention_days(c.id, 'notifications');
    if d is not null then
      delete from parcel_notifications n2
        where n2.company_id = c.id
          and n2.created_at < now() - make_interval(days => d)
          and not exists (
            select 1 from parcels p
              where p.id = n2.parcel_id
                and p.status not in ('delivered', 'rejected', 'returned', 'removed'));
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'parcel_notification', c.id::text, null,
          jsonb_build_object('table', 'parcel_notifications', 'deleted', n, 'retention_days', d));
      end if;

      delete from asset_loan_notifications n2
        where n2.company_id = c.id
          and n2.created_at < now() - make_interval(days => d)
          and not exists (
            select 1 from asset_loans l
              where l.id = n2.loan_id and l.returned_at is null);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'asset_loan_notification', c.id::text, null,
          jsonb_build_object('table', 'asset_loan_notifications', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Pakker (kun LUKKEDE) --------------------------------------------
    -- En åben eller omtvistet pakke slettes aldrig af et vindue: den er stadig
    -- under behandling, og dokumentationen skal bestå. Lukketidspunktet er
    -- udleverings- eller annulleringstidspunktet, ellers sidste ændring.
    d := retention_days(c.id, 'parcels');
    if d is not null then
      select array_agg(id) into v_ids
        from parcels
        where company_id = c.id
          and status in ('delivered', 'rejected', 'returned', 'removed')
          and coalesce(delivered_at, removed_at, updated_at) < now() - make_interval(days => d);

      if v_ids is not null and array_length(v_ids, 1) > 0 then
        -- Historikken først (FK'en er 'restrict'), derefter pakken. Fotos og
        -- underskrifter i Storage bliver forældreløse og fjernes af det
        -- daglige parcel-files-cleanup-job, som rydder forældreløse filer
        -- uanset vindue.
        delete from parcel_events where parcel_id = any(v_ids);
        delete from parcels where id = any(v_ids);
        get diagnostics n = row_count;
        perform record_audit(c.id, 'retention.purged', 'parcel', c.id::text, null,
          jsonb_build_object('table', 'parcels', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Udlånshistorik ---------------------------------------------------
    -- Låntagerens kontaktoplysninger er ryddet ved retur; her fjernes selve
    -- historikken efter vinduet. Aktive udlån røres ikke.
    d := retention_days(c.id, 'asset_loans');
    if d is not null then
      delete from asset_loans
        where company_id = c.id
          and returned_at is not null
          and returned_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'asset_loan', c.id::text, null,
          jsonb_build_object('table', 'asset_loans', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Bookinger (kun TERMINALE) ---------------------------------------
    -- Annullerede bookinger måles fra annulleringen, afholdte fra sluttiden.
    -- En fremtidig aktiv booking røres aldrig. Hændelserne slettes først
    -- (booking_events.booking_id er 'restrict').
    d := retention_days(c.id, 'bookings');
    if d is not null then
      -- Fakturagrundlaget (invoice_draft_lines.booking_id er 'restrict'):
      -- en booking på en ANNULLERET kladde har døde linjer, som ryddes med;
      -- en booking på en åben eller OVERFØRT kladde er et bilag og bliver
      -- stående, indtil kladden er væk. Uden det stopper hele purgen for
      -- alle kunder ved den første FK-fejl (rettet 2026-09-14).
      select array_agg(b.id) into v_ids
        from bookings b
        where b.company_id = c.id
          and ((b.status = 'cancelled' and b.cancelled_at < now() - make_interval(days => d))
            or (b.status = 'booked' and b.ends_at < now() - make_interval(days => d)))
          and not exists (
            select 1 from invoice_draft_lines l
              join invoice_drafts dr on dr.id = l.draft_id
              where l.booking_id = b.id and dr.status <> 'cancelled');

      if v_ids is not null and array_length(v_ids, 1) > 0 then
        delete from invoice_draft_lines l
          using invoice_drafts dr
          where dr.id = l.draft_id and dr.status = 'cancelled' and l.booking_id = any(v_ids);
        delete from booking_events where booking_id = any(v_ids);
        delete from bookings where id = any(v_ids);
        get diagnostics n = row_count;
        perform record_audit(c.id, 'retention.purged', 'booking', c.id::text, null,
          jsonb_build_object('table', 'bookings', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Ruteplaner -------------------------------------------------------
    d := retention_days(c.id, 'routes');
    if d is not null then
      delete from routes
        where company_id = c.id and updated_at < now() - make_interval(days => d);
      get diagnostics n = row_count;
      if n > 0 then
        perform record_audit(c.id, 'retention.purged', 'route', c.id::text, null,
          jsonb_build_object('table', 'routes', 'deleted', n, 'retention_days', d));
      end if;
    end if;

    -- --- Fratrådte medarbejdere ------------------------------------------
    -- ANONYMISERES, slettes ikke: pakkehistorikken peger på rækken. Kun
    -- inaktive uden åbne pakker, og aldrig én der allerede er anonymiseret.
    d := retention_days(c.id, 'employees');
    if d is not null then
      n := 0;
      for emp in
        select e.id
          from employees e
          where e.company_id = c.id
            and e.is_active = false
            and e.anonymized_at is null
            and coalesce(e.retired_at, e.updated_at) < now() - make_interval(days => d)
            and not public.employee_has_open_parcels(e.id)
      loop
        perform public.anonymize_employee_internal(emp.id, 'Anonymiseret (opbevaringsperiode)');
        n := n + 1;
      end loop;
      if n > 0 then
        perform record_audit(c.id, 'retention.anonymized', 'employee', c.id::text, null,
          jsonb_build_object('table', 'employees', 'anonymized', n, 'retention_days', d));
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function public.run_retention_purge() from public, anon, authenticated;

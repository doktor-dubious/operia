-- Momskoder dér, hvor momsen faktisk afgøres (EVU-krav A-06, C-06).
--
-- Momsen på en linje følger, HVAD der faktureres — ikke hvad det koster, og
-- ikke hvornår. Koden lå hidtil på taksten (C-05), hvilket var forkert sted:
-- et lokales momsbehandling ændrer sig ikke, fordi prisen gør. Nu bor den på
-- den slags ting, linjen handler om, og kunden vedligeholder den selv, hvor
-- de vedligeholder tingen:
--   * ressourcekategorien  (Booking → Kategorier)         → lokalelinjen
--   * kursistniveauet      (Konfigurér → Booking)          → kursistlinjen
--   * tilkøbsydelsen       (Booking → Tilkøbsydelser)      → tilkøbslinjen
-- Operia regner ikke moms. Koden er den, kundens regnskabssystem forventer, og
-- er fri tekst indtil regnskabssystemet er valgt (C-02) — så bliver den en
-- opslagsliste hentet derfra.
--
-- Taksternes momskode fjernes: ingen takst havde en, og to steder at lede
-- efter samme oplysning er en vedligeholdelsesfælde.

alter table public.booking_categories
  add column if not exists vat_code text
    check (vat_code is null or (char_length(btrim(vat_code)) between 1 and 16 and vat_code !~ '[[:cntrl:]]'));
alter table public.booking_participant_levels
  add column if not exists vat_code text
    check (vat_code is null or (char_length(btrim(vat_code)) between 1 and 16 and vat_code !~ '[[:cntrl:]]'));
alter table public.booking_services
  add column if not exists vat_code text
    check (vat_code is null or (char_length(btrim(vat_code)) between 1 and 16 and vat_code !~ '[[:cntrl:]]'));

alter table public.booking_tariffs drop column if exists vat_code;

-- Takstvagten normaliserede vat_code; kolonnen er væk, så vagten genskrives uden.
create or replace function public.booking_tariffs_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid;
begin
  new.note := nullif(btrim(coalesce(new.note, '')), '');

  if (new.scope = 'resource' and new.resource_id is null)
     or (new.scope = 'service' and new.service_id is null)
     or (new.scope = 'level' and new.level_id is null) then
    return new;
  end if;

  if new.scope = 'resource' then
    select company_id into v_owner from public.booking_resources where id = new.resource_id;
  elsif new.scope = 'service' then
    select company_id into v_owner from public.booking_services where id = new.service_id;
  else
    select company_id into v_owner from public.booking_participant_levels where id = new.level_id;
  end if;

  if v_owner is null or v_owner <> new.company_id then
    raise exception 'tariff_target_other_company' using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

-- Spor: momskoden er fakturagrundlag, og en ændring skal kunne findes igen.
-- Én funktion til alle tre tabeller; handlingen navngives efter tabellen.
create or replace function public.audit_booking_vat_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_entity text := case tg_table_name
    when 'booking_categories' then 'booking_category'
    when 'booking_participant_levels' then 'booking_level'
    else 'booking_service' end;
begin
  if new.vat_code is distinct from old.vat_code then
    perform public.record_audit(new.company_id, v_entity || '.vat_changed', v_entity,
      new.id::text, new.name,
      jsonb_build_object('from_vat', old.vat_code, 'to_vat', new.vat_code));
  end if;
  return new;
end;
$fn$;

drop trigger if exists audit_vat_trg on public.booking_categories;
create trigger audit_vat_trg after update on public.booking_categories
  for each row execute function public.audit_booking_vat_change();
drop trigger if exists audit_vat_trg on public.booking_participant_levels;
create trigger audit_vat_trg after update on public.booking_participant_levels
  for each row execute function public.audit_booking_vat_change();
drop trigger if exists audit_vat_trg on public.booking_services;
create trigger audit_vat_trg after update on public.booking_services
  for each row execute function public.audit_booking_vat_change();

-- Generatoren: samme funktion, tre andre kilder til momskoden.
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
  if not public.can_manage_bookings(p_company_id) then
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

-- Fakturakladde ud fra bookingen (EVU-krav C-01, C-06, C-07, C-08, C-10).
--
-- Kravet: "Systemet skal automatisk danne en fakturakladde ud fra bookingen
-- efter princippet lokale × antal dage × pris. Accept: Kladden dannes uden
-- manuel indtastning af linjer."
--
-- Kladden er OPERIAS EGEN. Den er ikke en e-conomic-kladde, ikke en
-- Dynamics-kladde: den er en neutral model med linjer, beløb og en status, og
-- overførslen til et regnskabssystem er et felt (`external_system`) plus en
-- adapter uden for basen. Det er C-02's opgave, og indtil det system er valgt,
-- kan fakturanummeret skrives ind i hånden — hele faktureringsgevinsten er
-- altså i brug, før integrationen findes.
--
-- PRISEN ER ET SNAPSHOT. Linjen bærer sin egen enhedspris, kopieret fra
-- taksten (C-05) på bookingens STARTDATO. En senere prisændring rører derfor
-- ikke en kladde, der allerede er dannet — det er halvdelen af C-05's
-- acceptkriterie, og den halvdel hører hjemme her.
--
-- INGEN BOOKING KAN OVERSES (C-04). Generatoren springer aldrig noget over i
-- stilhed: kan en booking ikke prissættes, kommer den tilbage i svarets
-- `skipped` med en årsag, så den, der fakturerer, ser præcis hvad der IKKE kom
-- med. En tavs udeladelse ville være den værste fejl, denne kode kunne lave.

-- ---------------------------------------------------------------------------
-- 1) Hvordan en "dag" tælles
-- ---------------------------------------------------------------------------
-- Kunden har ikke svaret på, om "antal dage" er kalenderdage eller hverdage
-- (spørgsmål 4 i docs/evu-booking-kravstatus.md). Svaret bliver en indstilling
-- og ikke en migration. Standard er kalenderdage, fordi et lokale er optaget
-- lørdag, uanset om nogen bruger det.
alter table public.companies
  add column if not exists booking_day_basis text not null default 'calendar';

alter table public.companies
  drop constraint if exists companies_booking_day_basis_check;
alter table public.companies
  add constraint companies_booking_day_basis_check
  check (booking_day_basis in ('calendar', 'weekday'));

comment on column public.companies.booking_day_basis is
  'Hvordan "antal dage" tælles i fakturakladden: calendar = alle dage, weekday = kun man-fre (EVU C-01).';

-- Antal dage en booking løber over, efter virksomhedens tælleregel.
-- Altid mindst 1: en booking på to timer er én dag på en dagstakst.
create or replace function public.booking_day_count(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_basis text default 'calendar'
)
returns integer
language sql
immutable
as $fn$
  select greatest(
    case
      when coalesce(p_basis, 'calendar') = 'weekday' then (
        select count(*)::int
        from generate_series(p_starts_at::date, p_ends_at::date, interval '1 day') d
        where extract(isodow from d) between 1 and 5
      )
      else (p_ends_at::date - p_starts_at::date) + 1
    end,
    1
  )
$fn$;

-- ---------------------------------------------------------------------------
-- 2) Kladden
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'transferred', 'cancelled')),

  -- Perioden kladden dækker — udledt af de medtagne bookinger, så udskriften
  -- kan sige hvad den handler om uden at slå linjerne op.
  period_from date,
  period_to date,
  currency text not null,

  -- Debitor. Bookingen kender i dag en MEDARBEJDER, ikke en kunde med CVR/EAN
  -- (spørgsmål 3). Felterne er derfor fri tekst og et snapshot: når debitor
  -- bliver en rigtig ting på bookingen, fyldes de af generatoren i stedet for
  -- i hånden, og alt der allerede er dannet, står uændret.
  bill_to_name text,
  bill_to_ref text,
  note text,

  -- Overførsel — systemuafhængigt. `external_system` er 'manual', indtil et
  -- regnskabssystem er valgt (C-02).
  external_system text,
  external_id text,
  invoice_no text,
  transferred_at timestamptz,
  transferred_by uuid,

  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),

  constraint invoice_drafts_number_uniq unique (company_id, number),
  constraint invoice_drafts_text_sane check (
    (bill_to_name is null or (char_length(bill_to_name) <= 200 and bill_to_name !~ '[[:cntrl:]]'))
    and (bill_to_ref is null or (char_length(bill_to_ref) <= 100 and bill_to_ref !~ '[[:cntrl:]]'))
    and (note is null or (char_length(note) <= 1000 and note !~ '[[:cntrl:]]'))
    and (invoice_no is null or (char_length(invoice_no) <= 60 and invoice_no !~ '[[:cntrl:]]'))
    and (external_id is null or (char_length(external_id) <= 100 and external_id !~ '[[:cntrl:]]'))
  )
);

create index if not exists invoice_drafts_company_idx
  on public.invoice_drafts (company_id, created_at desc);

create table if not exists public.invoice_draft_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  draft_id uuid not null references public.invoice_drafts(id) on delete cascade,
  -- Hvilken booking linjen kom fra. `restrict`: en booking, der er faktureret,
  -- må ikke kunne slettes bag om grundlaget.
  booking_id uuid references public.bookings(id) on delete restrict,

  -- Hvor linjen stammer fra. 'resource' er lokalet (C-01), 'participants' er
  -- kursisttaksten (C-07), 'service' er et tilkøb (C-06), 'manual' er en linje,
  -- et menneske har tilføjet.
  source text not null check (source in ('resource', 'participants', 'service', 'manual')),
  description text not null,
  quantity numeric(12,2) not null check (quantity >= 0),
  unit text,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  vat_code text,
  amount numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),

  constraint invoice_draft_lines_text_sane check (
    char_length(btrim(description)) between 1 and 300 and description !~ '[[:cntrl:]]'
    and (unit is null or char_length(unit) <= 20)
    and (vat_code is null or char_length(vat_code) <= 16)
  )
);

create index if not exists invoice_draft_lines_draft_idx
  on public.invoice_draft_lines (draft_id, sort_order, created_at);
create index if not exists invoice_draft_lines_booking_idx
  on public.invoice_draft_lines (booking_id);

-- Én booking kan kun ligge på én kladde. Kolonnen ER værnet — et tjek i
-- generatoren ville kunne tabe et kapløb mellem to samtidige kørsler.
alter table public.bookings
  add column if not exists invoice_draft_id uuid references public.invoice_drafts(id) on delete set null;

create index if not exists bookings_invoice_draft_idx
  on public.bookings (invoice_draft_id) where invoice_draft_id is not null;

-- Løbenummer pr. kunde, samme mønster som aktivnumrene.
create table if not exists public.invoice_draft_seq (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_value bigint not null default 0
);

-- ---------------------------------------------------------------------------
-- 3) Adgang
-- ---------------------------------------------------------------------------
alter table public.invoice_drafts enable row level security;
alter table public.invoice_draft_lines enable row level security;
alter table public.invoice_draft_seq enable row level security;

drop policy if exists invoice_drafts_select on public.invoice_drafts;
create policy invoice_drafts_select on public.invoice_drafts
  for select to authenticated
  using ((company_id = public.current_company_id()
          and public.has_any_role('manager', 'booking_manager'))
         or public.is_platform_admin());

drop policy if exists invoice_draft_lines_select on public.invoice_draft_lines;
create policy invoice_draft_lines_select on public.invoice_draft_lines
  for select to authenticated
  using ((company_id = public.current_company_id()
          and public.has_any_role('manager', 'booking_manager'))
         or public.is_platform_admin());

-- Ingen skrivepolitik. Kladder og linjer skrives KUN gennem RPC'erne nedenfor,
-- på samme måde som bookinger: et fakturagrundlag, en klient kan redigere
-- direkte, er ikke et grundlag.
--
-- Rettighederne skal stadig gives eksplicit — Supabases standardrettigheder i
-- public giver kun REFERENCES/TRIGGER/TRUNCATE, så PostgREST ville ellers
-- svare 403 på selve læsningen, RLS-politikken til trods.
grant select on public.invoice_drafts to authenticated;
grant select on public.invoice_draft_lines to authenticated;
revoke truncate, trigger on public.invoice_drafts, public.invoice_draft_lines,
  public.invoice_draft_seq from anon, authenticated;
revoke all on public.invoice_draft_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Frys efter overførsel
-- ---------------------------------------------------------------------------
-- En overført kladde er sendt ud af huset. Bagefter er den et bilag, ikke et
-- arbejdsdokument.
create or replace function public.invoice_draft_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status text;
begin
  select status into v_status from public.invoice_drafts
   where id = coalesce(new.draft_id, old.draft_id);
  if v_status = 'transferred' then
    raise exception 'draft_transferred' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists invoice_draft_lines_guard_trg on public.invoice_draft_lines;
create trigger invoice_draft_lines_guard_trg
  before insert or update or delete on public.invoice_draft_lines
  for each row execute function public.invoice_draft_lines_guard();

-- ---------------------------------------------------------------------------
-- 5) Generatoren
-- ---------------------------------------------------------------------------
-- Danner én kladde ud fra et udvalg af bookinger. Udvalget er en LISTE, ikke
-- én booking: C-03 vil kunne fakturere "en periode i én arbejdsgang", og
-- forskellen mellem én og mange er så en markering i skærmbilledet.
--
-- Svaret er jsonb og ikke bare et id, fordi de bookinger, der IKKE kom med, er
-- lige så vigtige som dem der gjorde (C-04).
create or replace function public.generate_invoice_draft(
  p_company_id uuid,
  p_booking_ids uuid[],
  p_note text default null
)
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
    select bk.*, r.name as resource_name, l.name as level_name
    from public.bookings bk
    join public.booking_resources r on r.id = bk.resource_id
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
        v_qty, t.unit, t.amount, t.vat_code, v_sort);
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
          v_qty, t.unit, t.amount, t.vat_code, v_sort);
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
      'service', sl.unit_price, null,
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
$fn$;

revoke all on function public.generate_invoice_draft(uuid, uuid[], text) from public;
grant execute on function public.generate_invoice_draft(uuid, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Livsforløbet
-- ---------------------------------------------------------------------------
-- Godkendelsestrinnet (C-08). Kravet vil have en "ansvarlig", der frigiver
-- grundlaget, og at godkenderen fremgår af loggen. Rollen er indtil videre
-- manager/booking_manager; en egentlig økonomirolle er F-01.
create or replace function public.approve_invoice_draft(p_draft_id uuid, p_approve boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d record;
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  if not public.can_manage_bookings(d.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if d.status = 'transferred' then
    raise exception 'draft_transferred' using errcode = 'P0001';
  end if;
  if d.status = 'cancelled' then
    raise exception 'draft_cancelled' using errcode = 'P0001';
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
$fn$;

-- Overførslen (C-02's Operia-halvdel). Systemuafhængig med vilje: 'manual'
-- dækker "nogen tastede fakturaen ind i regnskabssystemet og skrev nummeret
-- her", og en senere adapter sætter blot sit eget navn og sit eget id.
--
-- Det er HER bookingerne bliver faktureret. `set_booking_invoiced` er stadig
-- den eneste vej til `invoiced_at`, så låsen i A-03 og hændelsen i D-01 følger
-- med uden at blive gentaget.
create or replace function public.transfer_invoice_draft(
  p_draft_id uuid,
  p_invoice_no text,
  p_system text default 'manual',
  p_external_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d record;
  v_no text := nullif(btrim(coalesce(p_invoice_no, '')), '');
  v_sys text := nullif(btrim(coalesce(p_system, '')), '');
  b record;
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  if not public.can_manage_bookings(d.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if d.status = 'cancelled' then
    raise exception 'draft_cancelled' using errcode = 'P0001';
  end if;
  if d.status = 'transferred' then
    raise exception 'draft_transferred' using errcode = 'P0001';
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

  for b in select distinct booking_id from public.invoice_draft_lines
            where draft_id = p_draft_id and booking_id is not null
  loop
    perform public.set_booking_invoiced(b.booking_id, true);
  end loop;

  perform public.record_audit(d.company_id, 'invoice_draft.transferred', 'invoice_draft',
    p_draft_id::text, d.number,
    jsonb_build_object('system', coalesce(v_sys, 'manual')));
end;
$fn$;

-- Annullering af en kladde: bookingerne slippes fri, så de kan komme med på en
-- ny. En overført kladde kan ikke annulleres — den skal krediteres (C-09).
create or replace function public.cancel_invoice_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d record;
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  if not public.can_manage_bookings(d.company_id) then
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
$fn$;

-- En linje i hånden. Kravet siger, at kladden skal dannes UDEN manuel
-- indtastning — det gør den; dette er undtagelsen for det, generatoren ikke
-- kan vide (et aftalt afslag, en ekstra ydelse uden for kataloget).
create or replace function public.add_invoice_draft_line(
  p_draft_id uuid,
  p_description text,
  p_quantity numeric,
  p_unit_price numeric,
  p_vat_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d record;
  v_id uuid;
  v_sort integer;
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  if not public.can_manage_bookings(d.company_id) then
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
$fn$;

create or replace function public.remove_invoice_draft_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  l record;
  d record;
begin
  select * into l from public.invoice_draft_lines where id = p_line_id;
  if not found then
    raise exception 'line_not_found' using errcode = 'P0002';
  end if;
  select * into d from public.invoice_drafts where id = l.draft_id;
  if not public.can_manage_bookings(d.company_id) then
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
$fn$;

revoke all on function public.approve_invoice_draft(uuid, boolean) from public;
revoke all on function public.transfer_invoice_draft(uuid, text, text, text) from public;
revoke all on function public.cancel_invoice_draft(uuid) from public;
revoke all on function public.add_invoice_draft_line(uuid, text, numeric, numeric, text) from public;
revoke all on function public.remove_invoice_draft_line(uuid) from public;

grant execute on function public.approve_invoice_draft(uuid, boolean) to authenticated;
grant execute on function public.transfer_invoice_draft(uuid, text, text, text) to authenticated;
grant execute on function public.cancel_invoice_draft(uuid) to authenticated;
grant execute on function public.add_invoice_draft_line(uuid, text, numeric, numeric, text) to authenticated;
grant execute on function public.remove_invoice_draft_line(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Kladden i udtrækket og i loggen
-- ---------------------------------------------------------------------------
-- Fakturagrundlaget er kundens data og skal med i F-08-udtrækket. Hvidlisten
-- er håndskrevet, og fixturen fejler, hvis en ny company_id-tabel hverken står
-- der eller i undtagelserne (se 20260912090000) — derfor tilføjes de tre her,
-- i samme migration som tabellerne.
CREATE OR REPLACE FUNCTION public.company_export_catalog()
 RETURNS TABLE(grp text, tbl text, ord integer)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select * from (values
    -- Kerne: det der findes uanset hvilke produkter kunden har købt.
    ('core', 'companies',                   10),
    ('core', 'app_users',                   20),
    ('core', 'employees',                   30),
    ('core', 'departments',                 40),
    ('core', 'company_products',            50),
    ('core', 'company_features',            60),
    ('core', 'company_retention',           70),
    ('core', 'company_templates',           80),
    ('core', 'app_text_override',           90),
    ('core', 'company_home_config',        100),
    ('core', 'company_handheld_config',    110),
    ('core', 'product_appearance',         120),
    ('core', 'company_ai_config',          130),
    ('core', 'company_accounting_config',  140),
    ('core', 'company_data_transfer',      150),
    ('core', 'company_entra_config',       160),
    ('core', 'company_slack_config',       170),
    ('core', 'log_drains',                 180),
    ('core', 'account_emails',             190),
    ('core', 'import_configs',             200),
    ('core', 'import_runs',                210),
    ('core', 'inbound_files',              220),
    ('core', 'feedback',                   230),
    ('core', 'audit_log',                  240),

    ('parcels', 'parcels',                 10),
    ('parcels', 'parcel_events',           20),
    ('parcels', 'parcel_batches',          30),
    ('parcels', 'parcel_documents',        40),
    ('parcels', 'parcel_notifications',    50),
    ('parcels', 'storage_locations',       60),
    ('parcels', 'handling_classes',        70),
    ('parcels', 'carriers',                80),

    ('assets', 'assets',                   10),
    ('assets', 'asset_categories',         20),
    ('assets', 'asset_locations',          30),
    ('assets', 'asset_events',             40),
    ('assets', 'asset_loans',              50),
    ('assets', 'asset_loan_notifications', 60),
    ('assets', 'asset_documents',          70),

    ('lager',    'inventory_items',        10),
    ('lockers',  'lockers',                10),
    ('shipping', 'carrier_agreements',     10),
    ('routes',   'routes',                 10),

    ('booking', 'bookings',                    10),
    ('booking', 'booking_events',              20),
    ('booking', 'booking_resources',           30),
    ('booking', 'booking_categories',          40),
    ('booking', 'booking_services',            50),
    ('booking', 'booking_service_lines',       60),
    ('booking', 'booking_participant_levels',  70),
    ('booking', 'booking_notifications',       80),
    ('booking', 'booking_tariffs',             90),
    ('booking', 'invoice_drafts',             100),
    ('booking', 'invoice_draft_lines',        110)
  ) as v(grp, tbl, ord)
$function$;

-- Tælleren er en intern løbenummerkilde uden informationsindhold, som
-- aktivnumrenes. Den står i undtagelseslisten frem for i hvidlisten, så
-- fixturens dækningsprøve stadig går op.
create or replace function public.company_export_excluded()
returns table (tbl text, reason text)
language sql
immutable
as $fn$
  select * from (values
    -- Adgangsnøgler til kundens andre systemer — ikke kundens data.
    ('company_accounting_secret',    'secret'),
    ('company_data_transfer_secret', 'secret'),
    ('company_entra_secret',         'secret'),
    ('company_slack_secret',         'secret'),
    ('slack_oauth_state',            'secret'),
    -- Interne tællere og låse uden informationsindhold.
    ('asset_no_seq',       'counter'),
    ('parcel_barcode_seq', 'counter'),
    ('import_locks',       'counter'),
    ('invoice_draft_seq',  'counter')
  ) as v(tbl, reason)
$fn$;

-- Kladdens hændelser hører til bookingkategorien på Logs-siden. Uden dette
-- havner 'invoice_draft.*' i 'other', hvor ingen leder efter dem: præfikset
-- hedder ikke 'booking', selv om det er bookingens fakturagrundlag.
--
-- Kun det første led udvides; resten af funktionen er uændret. Den genskabes
-- af flere migrationer, så ændringen skal stå som en HEL definition.
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

-- Rettelser slår igennem på fakturagrundlaget (EVU-krav A-03, sidste led;
-- rører også A-05/A-07/C-10).
--
-- Kladden (C-01) dannes ud fra bookingen, som den ser ud i dét øjeblik. Men
-- A-03 siger, at bookingen kan rettes helt frem til fakturering — og indtil nu
-- var de to ting ikke forbundet: en booking på en godkendt kladde kunne få
-- ændret deltagerantal, tidsrum eller tilkøb, og kladden stod urørt med de
-- gamle beløb og et gyldigt "godkendt". Det er den farligste udgave af en
-- fejl i fakturering: tallene ser rigtige ud, og de er det ikke.
--
-- Løsningen er ikke at spærre bookingen (det ville bryde A-03), men at gøre
-- kladden ÆRLIG: en ændring på en booking, der ligger på en åben kladde,
-- stempler kladden som forældet, trækker en eventuel godkendelse tilbage (de
-- godkendte beløb gælder ikke længere), og hverken godkendelse eller
-- overførsel kan ske, før kladden er dannet igen. Er kladden overført, gælder
-- låsen fra A-02/A-03 i forvejen — dér er vejen en kreditnota (C-09).
--
-- Det er en TRIGGER og ikke et tjek i RPC'erne, af samme grund som
-- hændelsesloggen (D-02): enhver vej ind i tabellen skal ramme den, også en
-- migration eller et SQL-kald uden om brugerfladen.

alter table public.invoice_drafts
  add column if not exists stale_at timestamptz,
  add column if not exists stale_reason text
    check (stale_reason is null or stale_reason in
      ('booking_updated', 'booking_cancelled', 'services_changed'));

-- ---------------------------------------------------------------------------
-- 1) Stemplet
-- ---------------------------------------------------------------------------
create or replace function public.invoice_draft_mark_stale(p_booking_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d record;
begin
  select dr.* into d
  from public.bookings b
  join public.invoice_drafts dr on dr.id = b.invoice_draft_id
  where b.id = p_booking_id
    and dr.status in ('draft', 'approved');
  if not found then return; end if;

  update public.invoice_drafts
     set stale_at = now(),
         stale_reason = p_reason,
         -- En godkendelse af beløb, der ikke længere gælder, er ikke en
         -- godkendelse. Den trækkes tilbage, og godkenderen ser det i loggen.
         status = 'draft',
         approved_at = null,
         approved_by = null
   where id = d.id;

  perform public.record_audit(d.company_id, 'invoice_draft.stale', 'invoice_draft',
    d.id::text, d.number,
    jsonb_build_object('reason', p_reason, 'booking_id', p_booking_id,
                       'approval_cleared', d.status = 'approved'));
end;
$fn$;
revoke all on function public.invoice_draft_mark_stale(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 2) Hvad der udløser det
-- ---------------------------------------------------------------------------
-- Kun de felter, kladden regner på. Formål (title) og afbestillingsårsag rører
-- ikke beløbene og udløser ikke noget.
create or replace function public.bookings_draft_stale()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.invoice_draft_id is null then return new; end if;
  -- Kladden selv sætter/fjerner koblingen; det er ikke en rettelse.
  if new.invoice_draft_id is distinct from old.invoice_draft_id then return new; end if;
  if old.status = 'booked' and new.status = 'cancelled' then
    perform public.invoice_draft_mark_stale(new.id, 'booking_cancelled');
  elsif new.resource_id is distinct from old.resource_id
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.all_day is distinct from old.all_day
     or new.participant_count is distinct from old.participant_count
     or new.participant_level_id is distinct from old.participant_level_id then
    perform public.invoice_draft_mark_stale(new.id, 'booking_updated');
  end if;
  return new;
end;
$fn$;

drop trigger if exists bookings_draft_stale_trg on public.bookings;
create trigger bookings_draft_stale_trg
  after update on public.bookings
  for each row execute function public.bookings_draft_stale();

create or replace function public.booking_service_lines_draft_stale()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.invoice_draft_mark_stale(coalesce(new.booking_id, old.booking_id), 'services_changed');
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists booking_service_lines_draft_stale_trg on public.booking_service_lines;
create trigger booking_service_lines_draft_stale_trg
  after insert or update or delete on public.booking_service_lines
  for each row execute function public.booking_service_lines_draft_stale();

-- ---------------------------------------------------------------------------
-- 3) En forældet kladde kan hverken godkendes eller overføres
-- ---------------------------------------------------------------------------
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
$fn$;

create or replace function public.transfer_invoice_draft(
  p_draft_id uuid, p_invoice_no text, p_system text default 'manual', p_external_id text default null)
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

-- ---------------------------------------------------------------------------
-- 4) Dan igen
-- ---------------------------------------------------------------------------
-- Den gamle kladde annulleres, og en ny dannes af de samme bookinger med
-- debitor og note båret over. Ét kald, én transaktion: enten findes der en ny
-- kladde og en annulleret gammel, eller også er intet sket. Den gamle beholder
-- sit nummer og sit spor — et hul i rækken er bedre end en omskrevet historie.
create or replace function public.regenerate_invoice_draft(p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d record;
  v_ids uuid[];
  v_result jsonb;
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
$fn$;
revoke all on function public.regenerate_invoice_draft(uuid) from public;
grant execute on function public.regenerate_invoice_draft(uuid) to authenticated;

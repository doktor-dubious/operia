-- Overførsel til e-conomic (EVU-krav C-02) — adapteren.
--
-- Kladden er Operias egen (C-01); e-conomic er én modtager. Edge-funktionen
-- economic-transfer opretter en FAKTURAKLADDE i e-conomic ud fra vores kladde
-- (kundens skabelon giver layout, betalingsbetingelser og momszone; vores
-- linjer får produktnumre fra opsætningen) og skriver e-conomics kladdenummer
-- tilbage. Fakturanummeret findes først, når bogholderen bogfører i e-conomic
-- — eller straks, hvis kunden har valgt automatisk bogføring. "Hent
-- fakturanummer" slår det op på vores kladdenummer, som lægges i e-conomics
-- referencefelt ved oprettelsen.
--
-- Opsætningen: ét debitornummer (indtil debitorbegrebet findes — spørgsmål 3;
-- kladdens bill_to_ref kan overstyre pr. kladde) og ét produktnummer pr.
-- linjetype. Momsen afgøres af produktet i e-conomic.

alter table public.company_accounting_config
  add column if not exists economic_customer_number integer check (economic_customer_number is null or economic_customer_number > 0),
  add column if not exists economic_product_room text check (economic_product_room is null or char_length(economic_product_room) <= 25),
  add column if not exists economic_product_participants text check (economic_product_participants is null or char_length(economic_product_participants) <= 25),
  add column if not exists economic_product_service text check (economic_product_service is null or char_length(economic_product_service) <= 25),
  add column if not exists economic_auto_book boolean not null default false;

-- Fakturanummeret skrives tilbage, når det findes (bogført i e-conomic).
create or replace function public.record_invoice_booked(p_draft_id uuid, p_invoice_no text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d record;
  v_no text := nullif(btrim(coalesce(p_invoice_no, '')), '');
begin
  select * into d from public.invoice_drafts where id = p_draft_id;
  if not found then raise exception 'draft_not_found' using errcode = 'P0002'; end if;
  if not public.can_invoice_bookings(d.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if d.status <> 'transferred' then raise exception 'draft_not_transferred' using errcode = 'P0001'; end if;
  if v_no is null then raise exception 'invoice_no_required' using errcode = 'P0001'; end if;
  update public.invoice_drafts set invoice_no = v_no where id = p_draft_id;
  perform public.record_audit(d.company_id, 'invoice_draft.booked', 'invoice_draft',
    p_draft_id::text, d.number, jsonb_build_object('invoice_no', v_no, 'system', d.external_system));
end;
$fn$;
revoke all on function public.record_invoice_booked(uuid, text) from public;
grant execute on function public.record_invoice_booked(uuid, text) to authenticated;

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
  -- Manuel overførsel kræver nummeret her og nu. Går kladden til et
  -- regnskabssystem, er den en KLADDE dér, indtil bogholderen bogfører den —
  -- og først da findes fakturanummeret. Så må nummeret vente (C-02).
  if v_no is null and (coalesce(v_sys, 'manual') = 'manual' or p_external_id is null) then
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

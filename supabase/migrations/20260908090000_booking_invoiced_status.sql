-- Booking: statusmodellen booket → i brug → afsluttet → faktureret (EVU A-02).
--
-- Kravet (docs/Booking- og faktureringsløsning til EVU.txt, A-02) er ét
-- statusforløb, der følger bookingen af sig selv. Tre af de fire trin ER
-- allerede automatiske — de er tidens funktion og udledes af start/slut:
--   booket    = starttidspunktet er ikke nået
--   i brug    = nu ligger inde i intervallet
--   afsluttet = sluttidspunktet er passeret
-- Der er derfor intet at gemme for dem; en lagret kolonne ville kræve et cron-
-- job, der skrev det samme, uret allerede ved, og som kunne være bagud.
-- Udledningen sker ét sted i klienten (web/src/lib/booking.ts).
--
-- Det fjerde trin — FAKTURERET — er ikke tidens funktion. Det er en kendsgerning
-- om, at grundlaget er sendt til regnskabssystemet, og det skal derfor lagres.
-- Denne migration tilføjer den kendsgerning.
--
-- HVORFOR IKKE 'invoiced' SOM ENDNU EN VÆRDI I public.booking_status:
--   1. Dobbeltbookingsværnet er `exclude ... where (status = 'booked')`. Et
--      statusskifte til 'invoiced' ville tage bookingen UD af værnet, så det
--      samme tidsrum kunne bookes igen oven i en faktureret booking.
--   2. 'cancelled' og 'faktureret' er ikke hinandens alternativer: en booking,
--      der afbestilles EFTER fakturering, er begge dele og skal krediteres
--      (C-09). Ét felt kan ikke bære to uafhængige kendsgerninger.
-- Derfor: `status` bliver stående som bookingens tilstand (aktiv/annulleret),
-- og faktureringen får sit eget tidsstempel. Samme opdeling som parcels'
-- status vs. delivered_at.
--
-- Konsekvenser af at være faktureret (afledt af A-03 "rettes FREM TIL
-- fakturering" og C-09 "kreditnota EFTER fakturering"):
--   - update_booking afviser en faktureret booking — grundlaget er sendt.
--   - cancel_booking afviser den også; en afbestilling efter fakturering kræver
--     en kreditnota, og kreditnotaer findes ikke endnu (C-09). Fail-closed:
--     hellere blokere end lade en faktureret booking forsvinde ud af
--     fakturagrundlaget uden modpost.
--
-- Bevidst IKKE med her (senere krav): fakturanummer på bookingen (C-02),
-- fakturakladde og -linjer (C-01), godkendelsestrin (C-08), kreditnota (C-09).
--
-- ÅBENT PUNKT til aftalen (D-07), bevidst IKKE ændret her: opbevaringspurgen
-- (20260829090200 + 20260903140000) sletter afholdte bookinger efter
-- virksomhedens `company_retention.bookings_days` uden at se på invoiced_at.
-- Sætter en kunde vinduet kortere end bogføringslovens 5 år, forsvinder
-- fakturagrundlaget med. Standarden er NULL (= gem indtil videre), så ingen er
-- ramt i dag, men enten skal aftalte værdier respektere bogføringsloven, eller
-- purgen skal undtage fakturerede bookinger. Kræver en beslutning, ikke kode.

-- ---------------------------------------------------------------------------
-- 1. Kendsgerningen: hvornår, og af hvem
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column invoiced_at timestamptz,
  add column invoiced_by uuid references auth.users (id) on delete set null;

comment on column public.bookings.invoiced_at is
  'Sat når bookingen er overført til fakturering (EVU A-02, sidste trin i statusmodellen). NULL = ikke faktureret. De øvrige trin (booket/i brug/afsluttet) udledes af starts_at/ends_at og lagres ikke.';

-- Afstemningsopslaget "afsluttet, men ikke faktureret" (C-04/E-04) er den
-- eneste forespørgsel, der ikke kan nøjes med de eksisterende indeks: den
-- rammer et lille mindretal af rækkerne, og et delvist indeks holder det lille.
create index bookings_uninvoiced_idx
  on public.bookings (company_id, ends_at)
  where invoiced_at is null and status = 'booked';

-- ---------------------------------------------------------------------------
-- 2. audit_level: '..._cleared' er en tilbagerulning, ikke en succes
--
-- 'booking.invoice_cleared' fjerner en faktureringsmarkering igen. Det er
-- præcis den slags handling, det ugentlige gennemsyn på advarselsniveau
-- (docs/gdpr/incident-response.md §7) skal fange — som '..._overridden' og
-- '..._deleted', der allerede står på listen. Ingen eksisterende handling
-- ender på '_cleared'/'.cleared', så de lagrede niveauer på audit_log er
-- uændrede og skal ikke genberegnes.
--
-- Signaturen beholder `p_detail jsonb default null` — kolonnen `level` er en
-- lagret generated column, der kalder funktionen med ét eller to argumenter.
-- ---------------------------------------------------------------------------
create or replace function public.audit_level(p_action text, p_detail jsonb default null)
returns text language sql immutable as $$
  select case
    when p_action = 'ai.label_read' then
      case
        when coalesce(p_detail->>'outcome', '') = 'ok' then 'success'
        when coalesce(p_detail->>'outcome', '') in (
          'integration_disabled', 'not_configured', 'not_allowed', 'not_accepted',
          'model_no_vision', 'forbidden', 'refused', 'image_too_large',
          'unsupported_media_type', 'rate_limited'
        ) then 'warning'
        else 'error'
      end
    when p_action = 'ai.disclosure_withdrawn' then 'warning'
    when p_action = 'parcel.removed'
      or p_action like '%.failed' or p_action like '%\_failed' escape '\'
      or p_action like '%.bounced' or p_action like '%\_bounced' escape '\'
      or p_action = 'data_transfer.spoof_rejected'
      then 'error'
    when p_action = 'import.rejected'
      or p_action = 'user.impersonated'
      or p_action like '%.deleted' or p_action like '%\_deleted' escape '\'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or p_action like '%.written\_off' escape '\'
      or p_action like '%.overridden' or p_action like '%\_overridden' escape '\'
      or p_action like '%.complained' or p_action like '%\_complained' escape '\'
      or p_action like '%.cleared' or p_action like '%\_cleared' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned', 'removed'))
      then 'warning'
    else 'success'
  end
$$;

-- ---------------------------------------------------------------------------
-- 3. update_booking / cancel_booking: en faktureret booking er låst
--
-- Begge funktioner genskabes uændret fra 20260829120000 bortset fra det nye
-- vagtled — RPC'erne er kodebasens eneste skrivevej til bookings, så låsen
-- SKAL sidde her (browseren er utroværdig).
-- ---------------------------------------------------------------------------
create or replace function public.update_booking(
  p_booking_id uuid,
  p_resource_id uuid,
  p_employee_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text default null,
  p_all_day boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_booking public.bookings;
  v_resource public.booking_resources;
  v_employee public.employees;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_bookings(v_booking.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_booking.status <> 'booked' then
    raise exception 'booking_not_editable' using errcode = 'P0001';
  end if;
  -- A-03: bookingen kan rettes frem til fakturering — derefter er grundlaget
  -- sendt, og en ændring skal gå gennem en kreditnota (C-09).
  if v_booking.invoiced_at is not null then
    raise exception 'booking_invoiced' using errcode = 'P0001';
  end if;

  select * into v_resource from public.booking_resources
    where id = p_resource_id and company_id = v_booking.company_id;
  if not found then
    raise exception 'booking_resource_not_found' using errcode = 'P0002';
  end if;
  -- En deaktiveret ressource må beholde sine bookinger, men ikke få nye tider:
  -- kun hvis ressourcen er uændret OG tiden er uændret slipper den igennem.
  if not v_resource.is_active
     and (v_resource.id <> v_booking.resource_id
          or p_starts_at is distinct from v_booking.starts_at
          or p_ends_at is distinct from v_booking.ends_at) then
    raise exception 'booking_resource_inactive' using errcode = 'P0001';
  end if;

  select * into v_employee from public.employees
    where id = p_employee_id and company_id = v_booking.company_id;
  if not found then
    raise exception 'employee_not_found' using errcode = 'P0002';
  end if;
  if not v_employee.is_active and v_employee.id <> v_booking.employee_id then
    raise exception 'employee_inactive' using errcode = 'P0001';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'booking_invalid_interval' using errcode = 'P0001';
  end if;

  -- Retro-reglen rammer kun når tidsrummet ændres — titel/medarbejder på en
  -- igangværende eller afholdt booking kan altid rettes.
  if p_starts_at is distinct from v_booking.starts_at
     or p_ends_at is distinct from v_booking.ends_at then
    perform public.assert_booking_not_retro(
      v_booking.company_id, p_starts_at, p_ends_at, p_all_day);
  end if;

  begin
    update public.bookings
       set resource_id = v_resource.id,
           employee_id = v_employee.id,
           starts_at = p_starts_at,
           ends_at = p_ends_at,
           all_day = coalesce(p_all_day, false),
           title = nullif(btrim(coalesce(p_title, '')), '')
     where id = v_booking.id;
  exception when exclusion_violation then
    raise exception 'booking_overlap' using errcode = 'P0001';
  end;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_booking.id, v_booking.company_id, 'updated', auth.uid(),
     jsonb_build_object(
       'from_resource_id', v_booking.resource_id,
       'to_resource_id', v_resource.id,
       'from_employee_id', v_booking.employee_id,
       'to_employee_id', v_employee.id,
       'from_starts_at', v_booking.starts_at,
       'to_starts_at', p_starts_at,
       'from_ends_at', v_booking.ends_at,
       'to_ends_at', p_ends_at));
end;
$$;

create or replace function public.cancel_booking(
  p_booking_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_bookings(v_booking.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_booking.status <> 'booked' then
    raise exception 'booking_already_cancelled' using errcode = 'P0001';
  end if;
  -- Afbestilling efter fakturering kræver kreditnota (C-09) — findes ikke endnu.
  if v_booking.invoiced_at is not null then
    raise exception 'booking_invoiced' using errcode = 'P0001';
  end if;

  update public.bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid()
   where id = v_booking.id;

  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_booking.id, v_booking.company_id, 'cancelled', auth.uid(),
     jsonb_build_object(
       'resource_id', v_booking.resource_id,
       'starts_at', v_booking.starts_at,
       'ends_at', v_booking.ends_at));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. set_booking_invoiced: sæt eller fjern faktureringsmarkeringen
--
-- Den maskinelle vej ind i sidste trin. Når faktureringskørslen bygges
-- (C-01/C-03), er det DEN, der kalder herind, og statusskiftet sker uden
-- indtastning som A-02 kræver. Indtil da er kaldet bookingansvarliges
-- håndtag — broen der gør det sidste trin brugbart, før regnskabsintegrationen
-- findes (samme trinvise mønster som C-02's "manuel registrering af
-- fakturanummer som første trin").
--
-- Rettighedsgrænse: can_manage_bookings (manager/booking_manager), ikke
-- can_operate_bookings. At sende noget til fakturering er en økonomihandling,
-- og en booking_handler, der lægger bookinger ind, skal ikke kunne låse dem.
-- Får kunden senere en egentlig økonomirolle (F-01), er det denne grænse, der
-- flyttes.
--
-- Rækkefølgen i statusmodellen håndhæves: kun en AFSLUTTET booking kan
-- faktureres (ends_at passeret). Forudbetaling er ikke i kravene, og reglen er
-- det, der gør "afsluttet, ikke faktureret" (C-04) til en meningsfuld liste.
-- ---------------------------------------------------------------------------
create or replace function public.set_booking_invoiced(
  p_booking_id uuid,
  p_invoiced boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not public.can_manage_bookings(v_booking.company_id) then
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

    insert into public.booking_events
      (booking_id, company_id, event_type, actor_user_id, detail)
    values
      (v_booking.id, v_booking.company_id, 'invoiced', auth.uid(),
       jsonb_build_object(
         'resource_id', v_booking.resource_id,
         'starts_at', v_booking.starts_at,
         'ends_at', v_booking.ends_at));
  else
    if v_booking.invoiced_at is null then
      raise exception 'booking_not_invoiced' using errcode = 'P0001';
    end if;

    update public.bookings
       set invoiced_at = null,
           invoiced_by = null
     where id = v_booking.id;

    insert into public.booking_events
      (booking_id, company_id, event_type, actor_user_id, detail)
    values
      (v_booking.id, v_booking.company_id, 'invoice_cleared', auth.uid(),
       jsonb_build_object(
         'resource_id', v_booking.resource_id,
         'was_invoiced_at', v_booking.invoiced_at));
  end if;
end;
$$;

revoke execute on function public.set_booking_invoiced(uuid, boolean) from public, anon;
grant execute on function public.set_booking_invoiced(uuid, boolean) to authenticated;

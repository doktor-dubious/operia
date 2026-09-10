-- Ændringsloggen flyttes til DATABASENIVEAU (EVU-krav D-01 og D-02).
--
-- Indtil nu skrev RPC'erne selv deres hændelser. Det dækkede enhver KLIENT —
-- bookings har ingen skrivepolitik, så browseren kan kun ændre en booking
-- gennem create_booking/update_booking/cancel_booking/set_booking_invoiced —
-- men ikke en service-role-forbindelse, en psql-session, en migration eller en
-- edge-funktion. Og det er præcis dét, D-02's acceptkriterie beskriver:
-- "ændringer foretaget uden om brugerfladen logges på samme måde".
--
-- Nu er en rækketrigger den eneste skribent, og RPC'erne skriver ikke længere
-- selv. Det løser tre ting på én gang:
--   D-02  — enhver vej ind i tabellen logges, også dem vi ikke har opfundet endnu.
--   D-01  — før/efter dækker nu ALLE strukturelle felter, ikke kun de seks
--           nogen huskede at skrive ind i RPC'en. Et rettet formål blev fx
--           slet ikke logget før.
--   Støj  — et gem, der ikke ændrer noget, giver ingen hændelse længere.
--           RPC'en skrev en 'updated' ved hvert klik på Gem.
--
-- FRITEKST HOLDES UDE, MED VILJE. booking_events spejles til audit_log, som er
-- uforanderlig og videresendes til kundens log drains; fri tekst dér kan aldrig
-- trækkes tilbage. `title` (bookingens formål) og `cancellation_reason` kan
-- nævne andre end medarbejderen, så loggen registrerer KUN AT de blev ændret —
-- `title_changed` / `reason_changed` — ikke hvad der stod. Værdierne bor på
-- bookingen, hvor opbevaringsvinduet rammer dem. Det er en bevidst afvigelse
-- fra D-04's ordlyd ("før/efter-værdi"), og den bør stå i aftalen.
--
-- SLETNING skrives til audit_log direkte og ikke til booking_events:
-- booking_events.booking_id peger på bookings med 'restrict', så en hændelse om
-- en slettet booking ville bryde sin egen fremmednøgle. Bemærk i øvrigt, at
-- samme fremmednøgle gør en booking praktisk talt uslettelig ud af det blå: den
-- har altid mindst sin 'created'-hændelse, og hændelserne kan ikke slettes
-- (block_mutation). Kun opbevaringspurgen kommer igennem — den sætter
-- 'operia.retention_purge' og logger sin egen optælling, så triggeren tier for
-- ikke at skrive én revisionsrække pr. purget booking.
--
-- Grants ændres ikke: `create or replace` dropper ikke funktionerne.

-- ---------------------------------------------------------------------------
-- 1. Triggeren
-- ---------------------------------------------------------------------------
create or replace function public.audit_bookings_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
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

  v_type := case
    when old.status = 'booked' and new.status = 'cancelled' then 'cancelled'
    when old.invoiced_at is null and new.invoiced_at is not null then 'invoiced'
    when old.invoiced_at is not null and new.invoiced_at is null then 'invoice_cleared'
    else 'updated'
  end;

  -- Kontekst på de hændelser, et menneske slår op i Logs.
  if v_type <> 'updated' then
    v_detail := v_detail || jsonb_build_object('resource_id', new.resource_id);
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
$fn$;

create trigger audit_bookings_row_trg
  after insert or update or delete on public.bookings
  for each row execute function public.audit_bookings_row();

-- ---------------------------------------------------------------------------
-- 2. RPC'erne skriver ikke længere selv hændelser
--
-- Kropperne nedenfor er de nuværende, uændrede bortset fra at deres
-- `insert into public.booking_events`-blokke er fjernet. Skrev de stadig,
-- ville hver ændring give TO hændelser.
-- ---------------------------------------------------------------------------

create or replace function public.create_booking(p_resource_id uuid, p_employee_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_title text DEFAULT NULL::text, p_all_day boolean DEFAULT false, p_participant_count integer DEFAULT NULL::integer, p_participant_level_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_resource public.booking_resources;
  v_employee public.employees;
  v_id uuid;
begin
  select * into v_resource from public.booking_resources where id = p_resource_id;
  if not found then
    raise exception 'booking_resource_not_found' using errcode = 'P0002';
  end if;
  if not public.can_operate_bookings(v_resource.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not v_resource.is_active then
    raise exception 'booking_resource_inactive' using errcode = 'P0001';
  end if;

  select * into v_employee from public.employees
    where id = p_employee_id and company_id = v_resource.company_id;
  if not found then
    raise exception 'employee_not_found' using errcode = 'P0002';
  end if;
  if not v_employee.is_active then
    raise exception 'employee_inactive' using errcode = 'P0001';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'booking_invalid_interval' using errcode = 'P0001';
  end if;

  perform public.assert_booking_level(v_resource.company_id, p_participant_level_id, true);
  perform public.assert_participant_count(p_participant_count);
  perform public.assert_booking_not_retro(
    v_resource.company_id, p_starts_at, p_ends_at, p_all_day);

  begin
    insert into public.bookings
      (company_id, resource_id, employee_id, booked_by, starts_at, ends_at, all_day, title,
       participant_count, participant_level_id)
    values
      (v_resource.company_id, v_resource.id, v_employee.id, auth.uid(),
       p_starts_at, p_ends_at, coalesce(p_all_day, false), nullif(btrim(coalesce(p_title, '')), ''),
       p_participant_count, p_participant_level_id)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'booking_overlap' using errcode = 'P0001';
  end;


  return v_id;
end;
$function$;

create or replace function public.update_booking(p_booking_id uuid, p_resource_id uuid, p_employee_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_title text DEFAULT NULL::text, p_all_day boolean DEFAULT false, p_participant_count integer DEFAULT NULL::integer, p_participant_level_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Et deaktiveret niveau må BLIVE på bookingen, men ikke sættes på en ny —
  -- ellers kunne en rettelse af klokkeslættet vælte en booking, hvis niveau
  -- kunden har pensioneret i mellemtiden.
  perform public.assert_booking_level(
    v_booking.company_id, p_participant_level_id,
    p_participant_level_id is distinct from v_booking.participant_level_id);
  perform public.assert_participant_count(p_participant_count);

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
           title = nullif(btrim(coalesce(p_title, '')), ''),
           participant_count = p_participant_count,
           participant_level_id = p_participant_level_id
     where id = v_booking.id;
  exception when exclusion_violation then
    raise exception 'booking_overlap' using errcode = 'P0001';
  end;

end;
$function$;

create or replace function public.cancel_booking(p_booking_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_booking public.bookings;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if not public.can_cancel_bookings(v_booking.company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_booking.status <> 'booked' then
    raise exception 'booking_already_cancelled' using errcode = 'P0001';
  end if;
  -- Afbestilling efter fakturering kræver kreditnota (C-09) — findes ikke endnu.
  if v_booking.invoiced_at is not null then
    raise exception 'booking_invoiced' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'booking_reason_required' using errcode = 'P0001';
  end if;

  update public.bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         cancellation_reason = left(v_reason, 500)
   where id = v_booking.id;

  -- Hændelsen skrives af rækketriggeren audit_bookings_row (20260910160000),
  -- ikke her. Årsagens FRITEKST kommer aldrig med — loggen registrerer kun
  -- 'reason_changed'/'has_reason'; se triggerens hovedkommentar.
end;
$function$;

create or replace function public.set_booking_invoiced(p_booking_id uuid, p_invoiced boolean DEFAULT true)
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

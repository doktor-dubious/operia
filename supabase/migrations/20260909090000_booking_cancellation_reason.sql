-- Afbestilling af en booking med årsag (EVU-krav A-07).
--
-- Tidspunkt og ansvarlig blev allerede registreret (`cancelled_at` /
-- `cancelled_by`); det manglende tredje led var ÅRSAGEN. Den tilføjes her, og
-- samtidig flyttes selve handlingen op ad rettighedsstigen.
--
-- HVEM MÅ AFBESTILLE
--
-- Indtil nu kunne enhver med `can_operate_bookings` annullere — altså også en
-- booking_handler, der ellers kun lægger bookinger ind. Det er forkert, når
-- afbestillingen har en økonomisk konsekvens: en annulleret booking udgår af
-- fakturagrundlaget, og hvem der trak den ud, er et spørgsmål man skal kunne
-- stille bagefter. Grænsen flyttes derfor til manager/booking_manager.
--
-- Grænsen får sin EGEN funktion frem for at genbruge can_manage_bookings, selv
-- om rollesættet er det samme i dag: `can_manage_bookings` betyder "må rette i
-- stamdata", og afbestilling er en driftshandling. Skal afbestilling senere
-- have sin egen rolle (eller følge en økonomirolle, jf. krav F-01), er det
-- dette ene sted, der skal ændres — ikke et opslag spredt ud over RPC'er, der
-- tilfældigvis delte rollesæt.
--
-- ÅRSAGEN ER PÅKRÆVET. Kravet nævner den som en af tre ting, der SKAL
-- registreres, og en valgfri begrundelse er tom i langt de fleste rækker —
-- så ville kravet være opfyldt på papiret og ikke i praksis. Serveren afviser
-- en tom årsag med en maskinlæsbar kode, som klienten viser pænt.
--
-- Årsagen er fri tekst skrevet af et menneske og kan nævne andre end
-- bookingens medarbejder ("aflyst pga. Annas sygdom"). Den registreres derfor i
-- docs/gdpr/free-text-fields.md OG søges af indsigtsudtrækket nedenfor —
-- samme behandling som parcels.removed_reason.

-- ---------------------------------------------------------------------------
-- 1. Årsagen
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column cancellation_reason text;

alter table public.bookings
  add constraint bookings_cancellation_reason_sane
    check (cancellation_reason is null or
           (char_length(cancellation_reason) <= 500 and cancellation_reason !~ '[[:cntrl:]]'));

comment on column public.bookings.cancellation_reason is
  'Afbestillingsårsag (EVU A-07). Fri tekst, påkrævet ved annullering; NULL på bookinger der ikke er annulleret (og på dem der blev annulleret før 2026-09-09).';

-- ---------------------------------------------------------------------------
-- 2. Rettighedsgrænsen for afbestilling
-- ---------------------------------------------------------------------------
create or replace function public.can_cancel_bookings(p_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select (
    p_company_id = public.current_company_id()
    and public.has_any_role('manager', 'booking_manager')
  )
  or public.is_platform_admin()
$fn$;

revoke execute on function public.can_cancel_bookings(uuid) from public, anon;
grant execute on function public.can_cancel_bookings(uuid) to authenticated;

comment on function public.can_cancel_bookings(uuid) is
  'Må brugeren afbestille en booking? Samme rollesæt som can_manage_bookings i dag, men en egen grænse: afbestilling er en driftshandling med økonomisk konsekvens, ikke stamdata.';

-- ---------------------------------------------------------------------------
-- 3. cancel_booking med årsag
--
-- Den gamle etparameter-signatur DROPPES først: `create or replace` med en
-- længere parameterliste ville lave en overload, og to overloads gør
-- PostgREST-kaldet tvetydigt (PGRST203). Samme fælde som ved
-- create_booking/update_booking i 20260908190000.
-- ---------------------------------------------------------------------------
drop function if exists public.cancel_booking(uuid);

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $fn$
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

  -- Årsagen ryger IKKE i hændelsesloggen: booking_events spejles til audit_log,
  -- som er uforanderlig og videresendes til kundens log drains — fri tekst dér
  -- kan aldrig fjernes igen, heller ikke når bookingen anonymiseres eller
  -- slettes. Loggen bærer kendsgerningen (hvem, hvornår), og årsagen bor på
  -- bookingen, hvor opbevaringsvinduet rammer den. Samme afvejning som
  -- bookings.title.
  insert into public.booking_events
    (booking_id, company_id, event_type, actor_user_id, detail)
  values
    (v_booking.id, v_booking.company_id, 'cancelled', auth.uid(),
     jsonb_build_object(
       'resource_id', v_booking.resource_id,
       'starts_at', v_booking.starts_at,
       'ends_at', v_booking.ends_at,
       'has_reason', true));
end;
$fn$;

revoke execute on function public.cancel_booking(uuid, text) from public, anon;
grant execute on function public.cancel_booking(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Indsigtsudtrækket søger også i afbestillingsårsagen
--
-- Funktionen genskrives i sin helhed fra 20260829090200 med ÉN ændring:
-- 'bookings_mentioning' matchede kun på titlen, og en årsag kan nævne en anden
-- end bookingens medarbejder. Samme mønster som parcels' removed_reason.
-- ---------------------------------------------------------------------------
create or replace function public.sar_export(
  p_company_id uuid,
  p_employee_id uuid default null,
  p_query text default null
)
returns jsonb
language plpgsql
-- VOLATILE (standard): funktionen skriver en revisionsrække om at udtrækket er
-- lavet, og må derfor ikke markeres stable.
security definer
set search_path = public
as $$
declare
  lim integer := public.sar_section_limit();
  emp record;
  -- Skalarer ved siden af emp: ved fritekst-søgning findes der ingen
  -- medarbejderrække, og en ikke-tildelt record kan ikke læses.
  v_employee_no text;
  v_full_name text;
  v_email text;
  v_needle text;
  v_result jsonb;
  v_sections jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_parcel_ids uuid[] := '{}';
  v_user_id uuid;
begin
  -- 1) Autorisation. SECURITY DEFINER omgår RLS, så adgangen kontrolleres her:
  --    platform-admin, eller manager/data_manager i PRÆCIS den virksomhed.
  if not (
    public.is_platform_admin()
    or (p_company_id = public.current_company_id()
        and (public.has_role('manager') or public.has_role('data_manager')))
  ) then
    raise exception 'Ingen adgang til indsigtsudtræk for denne virksomhed'
      using errcode = '42501';
  end if;

  if p_employee_id is null and nullif(btrim(coalesce(p_query, '')), '') is null then
    raise exception 'Angiv enten en medarbejder eller en søgetekst';
  end if;

  -- 2) Emnet for udtrækket.
  if p_employee_id is not null then
    select * into emp from employees
      where id = p_employee_id and company_id = p_company_id;
    if not found then
      raise exception 'Medarbejderen findes ikke i denne virksomhed';
    end if;
    v_user_id := emp.user_id;
    v_employee_no := emp.employee_no;
    v_full_name := emp.full_name;
    v_email := emp.email;
    -- Navnet bruges også som fritekst-nål, så en pakke der nævner personen ved
    -- navn (uden fremmednøgle) kommer med i samme udtræk.
    v_needle := public.fold_name(coalesce(nullif(btrim(coalesce(p_query, '')), ''), emp.full_name));
  else
    v_needle := public.fold_name(btrim(p_query));
  end if;

  -- 3) Stamdata + brugerkonto.
  if p_employee_id is not null then
    v_sections := v_sections || jsonb_build_object('employee', to_jsonb(emp) - 'full_name_folded' - 'initials_folded');
    v_sections := v_sections || jsonb_build_object('user_account', (
      select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb)
      from (select user_id, company_id, email, full_name, created_at
              from app_users where user_id = v_user_id) u));
  end if;

  -- 4) Pakker hvor personen er modtager eller faktisk udleveret til.
  if p_employee_id is not null then
    select coalesce(array_agg(id), '{}') into v_parcel_ids
      from parcels
      where company_id = p_company_id
        and (receiver_employee_id = p_employee_id or delivered_employee_id = p_employee_id);
  end if;

  v_sections := v_sections || jsonb_build_object('parcels_as_subject', (
    select coalesce(jsonb_agg(to_jsonb(p) order by p.registered_at desc), '[]'::jsonb)
    from (select * from parcels
           where id = any(v_parcel_ids)
           order by registered_at desc limit lim) p));

  -- 5) Pakker der NÆVNER personen i fritekst — den del et opslag på id ikke
  --    finder. Folding gør søgningen robust over for store/små bogstaver og
  --    diakritiske tegn (æ/ø/å); fold_contains matcher på HELE ord, så 'Anne
  --    Jensen' ikke trækker 'Marianne Jensen's pakker med i udtrækket.
  v_sections := v_sections || jsonb_build_object('parcels_mentioning', (
    select coalesce(jsonb_agg(to_jsonb(p) order by p.registered_at desc), '[]'::jsonb)
    from (select * from parcels p2
           where p2.company_id = p_company_id
             and not (p2.id = any(v_parcel_ids))
             and (public.fold_contains(p2.delivered_to, v_needle)
               or public.fold_contains(p2.sender, v_needle)
               or public.fold_contains(p2.delivered_note, v_needle)
               or public.fold_contains(p2.receiver_override_reason, v_needle)
               or public.fold_contains(p2.removed_reason, v_needle)
               or public.fold_contains(p2.condition_note, v_needle))
           order by p2.registered_at desc limit lim) p));

  -- 6) Kæden af overdragelser: både hændelser PÅ personens pakker og hændelser
  --    personen selv har udført (den sidste er reelt en logbog over
  --    vedkommendes arbejdsdag og hører derfor med i et indsigtsudtræk).
  v_sections := v_sections || jsonb_build_object('parcel_events_on_subject_parcels', (
    select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
    from (select * from parcel_events
           where parcel_id = any(v_parcel_ids)
           order by created_at desc limit lim) e));

  v_sections := v_sections || jsonb_build_object('parcel_events_as_actor', (
    select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
    from (select * from parcel_events
           where company_id = p_company_id and actor_user_id = v_user_id and v_user_id is not null
           order by created_at desc limit lim) e));

  -- 7) Beskeder sendt til personen.
  v_sections := v_sections || jsonb_build_object('notifications', (
    select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb)
    from (select * from parcel_notifications
           where company_id = p_company_id
             and (employee_id = p_employee_id or parcel_id = any(v_parcel_ids))
           order by created_at desc limit lim) n));

  -- 8) Pakkedokumentation: fritekstnoterne kan selv bære navne (en
  --    fuldmagtsafhenter, en nabo — se docs/gdpr/free-text-fields.md), så de
  --    søges her: posterne på personens pakker OG poster hvis note nævner
  --    personen. Uden dette afsnit var en person, der KUN optræder i en note,
  --    usynlig for udtrækket.
  v_sections := v_sections || jsonb_build_object('parcel_documents', (
    select coalesce(jsonb_agg(to_jsonb(pd) order by pd.created_at desc), '[]'::jsonb)
    from (select d.* from parcel_documents d
           where d.company_id = p_company_id
             and (d.parcel_id = any(v_parcel_ids)
               or public.fold_contains(d.note, v_needle))
           order by d.created_at desc limit lim) pd));

  -- 9) Aktiver: udlån (også dem uden medarbejder-id, matchet på navn/e-mail),
  --    dokumentationsnoter der nævner personen, og hændelser personen har
  --    udført.
  v_sections := v_sections || jsonb_build_object('asset_loans', (
    select coalesce(jsonb_agg(to_jsonb(l) order by l.lent_at desc), '[]'::jsonb)
    from (select * from asset_loans l2
           where l2.company_id = p_company_id
             and (l2.employee_id = p_employee_id
               or public.fold_contains(l2.to_name, v_needle)
               or (v_email is not null and l2.to_email = v_email))
           order by lent_at desc limit lim) l));

  v_sections := v_sections || jsonb_build_object('asset_documents_mentioning', (
    select coalesce(jsonb_agg(to_jsonb(ad) order by ad.created_at desc), '[]'::jsonb)
    from (select d.* from asset_documents d
           where d.company_id = p_company_id
             and public.fold_contains(d.note, v_needle)
           order by d.created_at desc limit lim) ad));

  v_sections := v_sections || jsonb_build_object('asset_events_as_actor', (
    select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
    from (select * from asset_events
           where company_id = p_company_id and actor_user_id = v_user_id and v_user_id is not null
           order by created_at desc limit lim) e));

  -- 9b) Bookinger: personens egne bookinger (FK), bookinger hvis titel nævner
  --     personen (fritekst — samme grund som pakkerne i afsnit 5), og
  --     booking-hændelser personen selv har udført.
  v_sections := v_sections || jsonb_build_object('bookings_as_subject', (
    select coalesce(jsonb_agg(to_jsonb(b) order by b.starts_at desc), '[]'::jsonb)
    from (select * from bookings
           where company_id = p_company_id
             and employee_id = p_employee_id and p_employee_id is not null
           order by starts_at desc limit lim) b));

  v_sections := v_sections || jsonb_build_object('bookings_mentioning', (
    select coalesce(jsonb_agg(to_jsonb(b) order by b.starts_at desc), '[]'::jsonb)
    from (select * from bookings b2
           where b2.company_id = p_company_id
             and (b2.employee_id is distinct from p_employee_id or p_employee_id is null)
             and (public.fold_contains(b2.title, v_needle)
               or public.fold_contains(b2.cancellation_reason, v_needle))
           order by b2.starts_at desc limit lim) b));

  v_sections := v_sections || jsonb_build_object('booking_events_as_actor', (
    select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
    from (select * from booking_events
           where company_id = p_company_id and actor_user_id = v_user_id and v_user_id is not null
           order by created_at desc limit lim) e));

  -- 10) Filer: tilstandsfotos og underskrifter knyttet til personens pakker.
  --    Stien udleveres, ikke filen — udleveringen af selve billedet sker
  --    bevidst manuelt, så en kvittering ikke havner et forkert sted.
  v_sections := v_sections || jsonb_build_object('files', (
    select coalesce(jsonb_agg(f), '[]'::jsonb) from (
      select jsonb_build_object('parcel_id', id, 'bucket', 'parcel-photos', 'path', condition_photo_path) as f
        from parcels where id = any(v_parcel_ids) and condition_photo_path is not null
      union all
      select jsonb_build_object('parcel_id', id, 'bucket', 'signatures', 'path', delivered_signature_path)
        from parcels where id = any(v_parcel_ids) and delivered_signature_path is not null
      union all
      select jsonb_build_object('parcel_id', parcel_id, 'bucket', 'parcel-photos', 'path', storage_path)
        from parcel_documents where parcel_id = any(v_parcel_ids)
      limit lim) files));

  -- 11) Revisionsspor hvor personen er aktør. Rækkerne er minimerede (id'er og
  --     medarbejdernumre), men de handler om personen og hører derfor med.
  v_sections := v_sections || jsonb_build_object('audit_as_actor', (
    select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
    from (select id, action, entity_type, entity_id, summary, detail, created_at
            from audit_log
           where company_id = p_company_id and actor_user_id = v_user_id and v_user_id is not null
           order by created_at desc limit lim) a));

  -- 12) Tællinger + afkortnings-markering pr. afsnit.
  select jsonb_object_agg(key, jsonb_build_object(
           'rows', jsonb_array_length(value),
           'truncated', jsonb_array_length(value) >= lim))
    into v_counts
    from jsonb_each(v_sections)
    where jsonb_typeof(value) = 'array';

  v_result := jsonb_build_object(
    'generated_at', now(),
    'company', (select jsonb_build_object('id', id, 'name', name) from companies where id = p_company_id),
    'subject', jsonb_build_object(
      'employee_id', p_employee_id,
      'employee_no', v_employee_no,
      'name', v_full_name,
      'query', nullif(btrim(coalesce(p_query, '')), ''),
      'user_id', v_user_id),
    'section_limit', lim,
    'counts', coalesce(v_counts, '{}'::jsonb),
    'sections', v_sections,
    -- Art. 15(1) kræver mere end rækkerne: formål, kategorier, modtagere,
    -- opbevaring og rettigheder. De står i docs/gdpr/ og peges der på her, så
    -- svaret til den registrerede kan samles uden at skulle skrives forfra.
    'notice', jsonb_build_object(
      'purposes', 'Se docs/gdpr/ropa.md',
      'recipients', 'Se docs/gdpr/subprocessors.md',
      'retention', 'Se virksomhedens opbevaringsperioder (Konfigurér → Persondata) og docs/gdpr/ropa.md',
      'limitations', 'Udtrækket dækker Operia. Kopier i backup og i kundens eget logsystem (log-drain) indgår ikke.'));

  -- 13) Log at udtrækket er lavet — uden personoplysninger i selve loggen.
  perform public.record_audit(p_company_id, 'privacy.sar_exported', 'employee',
    coalesce(p_employee_id::text, 'query'), null,
    jsonb_build_object(
      'employee_no', v_employee_no,
      'by_query', p_employee_id is null,
      'counts', coalesce(v_counts, '{}'::jsonb)));

  return v_result;
end;
$$;

revoke execute on function public.sar_export(uuid, uuid, text) from public, anon;
grant execute on function public.sar_export(uuid, uuid, text) to authenticated;

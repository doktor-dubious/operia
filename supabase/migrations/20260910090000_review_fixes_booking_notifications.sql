-- Rettelser efter kodegennemgang 2026-09-10 (booking-notifikationer, e-mail-
-- udbydere, Logs).
--
-- 1. audit_level: grenen '%_deferred' → 'warning' (20260904150000) var stille
--    rullet tilbage — 20260908090000 blev bygget på en krop fra før den, og
--    20260908170000 kopierede den videre. Bekræftet mod pg_get_functiondef.
--    Kroppen her = 20260908170000 + den manglende gren. Kolonnen
--    audit_log.level er GENERERET (stored) — rækker skrevet i mellemtiden med
--    'success' for en udsættelse omskrives nedenfor.
-- 2. audit_category: 'email.*' (mail-config: nøgle gemt/ryddet, udbydertest)
--    får sin egen kategori, så et fejlet udbydertest ikke lander under 'Andet'.
--    Web-spejlet (operia.logs.tsx: categoryOf) er rettet samtidig og tager
--    også booking_service med — SQL fangede den allerede via 'booking%'.
-- 3. sar_export: afsnit 7b — booking_notifications (recipient = adressen der
--    blev sendt til, jf. docs/gdpr/ropa.md) manglede i indsigtsudtrækket.
-- 4. provider_id-indeks på de tre beskedlogge: webhooks fra udbyderen slår
--    op på udbyderens besked-id ved hvert bounce/klage (mail-events.ts).

-- ---------------------------------------------------------------------------
-- 1. audit_level
--
-- LÆRING (gentaget fra 20260908170000): kopiér ALTID den kørende krop
-- (pg_get_functiondef) og tilføj din gren. `default null` skal blive stående.
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
    when p_action = 'auth.password_reset_requested'
      and coalesce(p_detail->>'email_sent', '') = 'false' then 'error'
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
      or p_action like '%\_deferred' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned', 'removed'))
      then 'warning'
    else 'success'
  end
$$;

-- Allerede skrevne udsættelsesrækker: den genererede kolonne beregnes kun ved
-- insert/update, så de skubbes gennem en no-op-opdatering. audit_log er
-- append-only via trigger for almindelige roller; migrationen kører som
-- ejer, og ændringen rører ikke selve hændelsen — kun den afledte kolonne.
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'audit_log_immutable') then
    alter table public.audit_log disable trigger audit_log_immutable;
    update public.audit_log set action = action
      where action like '%\_deferred' escape '\' and level <> 'warning';
    alter table public.audit_log enable trigger audit_log_immutable;
  else
    update public.audit_log set action = action
      where action like '%\_deferred' escape '\' and level <> 'warning';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. audit_category
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $$
  select case
    when split_part(coalesce(p_action, ''), '.', 1) like 'booking%' then 'booking'
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
$$;

-- ---------------------------------------------------------------------------
-- 3. sar_export (fuld krop = 20260909090000 + afsnit 7b)
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
  v_phone text;
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
    v_phone := emp.phone;
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

  -- 7b) Booking-beskeder: `recipient` er adressen/nummeret beskeden gik til
  --     (registreret som personoplysning i docs/gdpr/ropa.md). Beskeder om
  --     personens egne bookinger, samt beskeder sendt til personens egne
  --     adresser i anden rolle (rekvirent, kopi).
  v_sections := v_sections || jsonb_build_object('booking_notifications', (
    select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb)
    from (select bn.* from booking_notifications bn
           where bn.company_id = p_company_id
             and (
               (p_employee_id is not null and exists (
                  select 1 from bookings b
                  where b.id = bn.booking_id and b.employee_id = p_employee_id))
               or (v_email is not null and lower(bn.recipient) = lower(v_email))
               or (v_phone is not null and bn.recipient = v_phone)
             )
           order by bn.created_at desc limit lim) n));

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

-- ---------------------------------------------------------------------------
-- 4. provider_id-indeks (partielt: kun rækker med et udbyder-id)
create index if not exists parcel_notifications_provider_id_idx
  on public.parcel_notifications (provider_id) where provider_id is not null;
create index if not exists booking_notifications_provider_id_idx
  on public.booking_notifications (provider_id) where provider_id is not null;
create index if not exists asset_loan_notifications_provider_id_idx
  on public.asset_loan_notifications (provider_id) where provider_id is not null;

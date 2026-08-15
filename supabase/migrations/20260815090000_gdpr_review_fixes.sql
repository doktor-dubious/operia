-- Rettelser fra code review af GDPR-ændringssættet (20260814*).
--
-- Fire fund, samlet her fordi de alle retter allerede-anvendte migrationer:
--
--   1. log_parcel_document_deleted (20260814190000) indsatte en parcel_events-
--      række OGSÅ når sletningen kom fra pakkens egen kaskade (purge/hård
--      sletning). Pakken er da allerede væk, så indsætningen ramte FK'en
--      parcel_events.parcel_id (on delete restrict) og væltede HELE den natlige
--      run_retention_purge for alle kunder.
--   2. run_retention_purge (20260814140000) slettede parcel_notifications på
--      alder alene. For en stadig ÅBEN pakke er de rækker dispatcherens
--      dedup- og påmindelsestæller-tilstand — sletning genstarter hele
--      påmindelsesstigen. Nu røres kun beskeder hvis pakke er lukket eller væk
--      (og udlånstvillingen: kun returnerede/forsvundne udlån).
--   3. Samme funktion tabte den gamle GLOBALE alderssletning af audit_log:
--      rækker for en SLETTET virksomhed (audit_log har bevidst ingen FK)
--      matchede hverken platform-grenen eller kundeløkken og blev aldrig
--      slettet. De følger nu platformens eget vindue.
--   4. sar_export (20260814150000) matchede fritekst som uforankret substring:
--      'Anne Jensen' matchede inde i 'Marianne Jensen' og trak en TREDJE
--      persons pakker med i indsigtsudtrækket. Samtidig blev fritekstnoterne i
--      parcel_documents/asset_documents slet ikke søgt — netop de felter
--      sletningsvejen (20260814190000) findes for. Matchning sker nu på
--      ordgrænser, og noterne har fået egne afsnit.

-- ---------------------------------------------------------------------------
-- 1. Dokumentslet-loggen: kun når pakken stadig findes.
--    Kommer sletningen fra pakkens kaskade, logger purgen/sletteren selv
--    (retention.purged / parcel.deleted) — og en hændelsesrække kan alligevel
--    ikke pege på en pakke der ikke findes.
-- ---------------------------------------------------------------------------
create or replace function public.log_parcel_document_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.parcels where id = old.parcel_id) then
    return old;
  end if;
  insert into public.parcel_events
    (parcel_id, company_id, event_type, actor_user_id, detail)
  values
    (old.parcel_id, old.company_id, 'document_deleted', auth.uid(),
     jsonb_build_object(
       'document_id', old.id,
       'had_note', coalesce(old.note, '') <> '',
       'had_file', old.storage_path is not null
     ));
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2+3. Purge-funktionen: beskedlog-værn + forældreløse audit-rækker.
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

-- ---------------------------------------------------------------------------
-- 4. Indsigtsudtrækket: ordgrænse-match + fritekstnoterne.
-- ---------------------------------------------------------------------------
-- fold_name reducerer alt ikke-alfanumerisk til mellemrum, så et match på
-- ' nål ' i ' høstak ' ER et match på hele ord — 'anne jensen' findes i
-- 'til anne jensen' men ikke længere inde i 'marianne jensen'. Nålen skal
-- allerede være foldet; foldningen fjerner samtidig LIKE-jokertegn (% og _),
-- så en søgetekst ikke kan udvide sit eget match.
create or replace function public.fold_contains(p_haystack text, p_needle text)
returns boolean
language sql
immutable
parallel safe
as $$
  select ' ' || coalesce(public.fold_name(p_haystack), '') || ' '
         like '% ' || p_needle || ' %'
$$;

comment on function public.fold_contains(text, text) is
  'Ordgrænse-match på foldet tekst: findes den (allerede foldede) nål som hele ord i høstakken?';

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

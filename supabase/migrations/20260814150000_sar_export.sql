-- Indsigtsudtræk (GDPR art. 15) — alt om én person, samlet ét sted.
--
-- Den dataansvarlige (kunden) skal kunne besvare en indsigtsanmodning inden for
-- en måned, og DCA er som databehandler forpligtet til at bistå (art. 28(3)(e)).
-- Hidtil krævede det en manuel forespørgsel i databasen: masterdata-eksporten
-- dækker kun aktive medarbejderes stamdata og kan ikke besvare en anmodning.
--
-- To indgange, fordi personoplysninger om en person ligger to steder:
--   1. Nøglet opslag (p_employee_id): følger fremmednøglerne — medarbejderrækken,
--      pakker som modtager/udleveret til, hændelser hvor personen var aktør,
--      beskeder, udlån, brugerkonto, revisionsspor.
--   2. Fritekst-søgning (p_query): en fuldmagtsafhenter eller en privat afsender
--      har ingen række — de findes KUN som en tekststreng i en anden persons
--      pakke (delivered_to, sender, årsagsfelter, noter). Uden dette led er
--      udtrækket ufuldstændigt for netop de registrerede, der ikke er ansatte.
--
-- Udtrækket LÆSER kun. Det gemmer intet, men logger at det er sket
-- (privacy.sar_exported) — et samlet udtræk om en person er i sig selv en
-- vidtgående behandling og skal kunne efterprøves. Loggen indeholder
-- medarbejdernummer og antal, aldrig navn, adresse eller indhold.

-- Hvor mange rækker pr. afsnit. Et udtræk skal kunne læses af et menneske og
-- passere gennem PostgREST; rammes loftet, siger svaret det eksplicit
-- (truncated: true), så ingen tror de har set alt.
create or replace function public.sar_section_limit()
returns integer language sql immutable as $$ select 500 $$;

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
  --    diakritiske tegn (æ/ø/å).
  v_sections := v_sections || jsonb_build_object('parcels_mentioning', (
    select coalesce(jsonb_agg(to_jsonb(p) order by p.registered_at desc), '[]'::jsonb)
    from (select * from parcels p2
           where p2.company_id = p_company_id
             and not (p2.id = any(v_parcel_ids))
             and (public.fold_name(coalesce(p2.delivered_to, '')) like '%' || v_needle || '%'
               or public.fold_name(coalesce(p2.sender, '')) like '%' || v_needle || '%'
               or public.fold_name(coalesce(p2.delivered_note, '')) like '%' || v_needle || '%'
               or public.fold_name(coalesce(p2.receiver_override_reason, '')) like '%' || v_needle || '%'
               or public.fold_name(coalesce(p2.removed_reason, '')) like '%' || v_needle || '%'
               or public.fold_name(coalesce(p2.condition_note, '')) like '%' || v_needle || '%')
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

  -- 8) Aktiver: udlån (også dem uden medarbejder-id, matchet på navn/e-mail) og
  --    hændelser personen har udført.
  v_sections := v_sections || jsonb_build_object('asset_loans', (
    select coalesce(jsonb_agg(to_jsonb(l) order by l.lent_at desc), '[]'::jsonb)
    from (select * from asset_loans l2
           where l2.company_id = p_company_id
             and (l2.employee_id = p_employee_id
               or public.fold_name(coalesce(l2.to_name, '')) like '%' || v_needle || '%'
               or (v_email is not null and l2.to_email = v_email))
           order by lent_at desc limit lim) l));

  v_sections := v_sections || jsonb_build_object('asset_events_as_actor', (
    select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb)
    from (select * from asset_events
           where company_id = p_company_id and actor_user_id = v_user_id and v_user_id is not null
           order by created_at desc limit lim) e));

  -- 9) Filer: tilstandsfotos og underskrifter knyttet til personens pakker.
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

  -- 10) Revisionsspor hvor personen er aktør. Rækkerne er minimerede (id'er og
  --     medarbejdernumre), men de handler om personen og hører derfor med.
  v_sections := v_sections || jsonb_build_object('audit_as_actor', (
    select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
    from (select id, action, entity_type, entity_id, summary, detail, created_at
            from audit_log
           where company_id = p_company_id and actor_user_id = v_user_id and v_user_id is not null
           order by created_at desc limit lim) a));

  -- 11) Tællinger + afkortnings-markering pr. afsnit.
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

  -- 12) Log at udtrækket er lavet — uden personoplysninger i selve loggen.
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

comment on function public.sar_export(uuid, uuid, text) is
  'GDPR art. 15: samlet udtræk om én person i én virksomhed. Kræver manager/data_manager i virksomheden eller platform-admin. Logger privacy.sar_exported.';

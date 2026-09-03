-- Opbevaring, booking: annullerede bookinger skal måles fra ANNULLERINGEN.
--
-- 20260829090200 skrev prædikatet som
--   (status = 'cancelled' and cancelled_at < grænse) or ends_at < grænse
-- hvor andet led ikke filtrerer på status og altså også rammer annullerede
-- bookinger. En booking der er efterregistreret bagud i tid (retroaktiv
-- booking er tilladt som standard) og derefter annulleret i dag, har et
-- ends_at der ligger uden for vinduet — den blev slettet ved næste purge,
-- ét døgn efter annulleringen i stedet for efter hele vinduet.
--
-- Reglen som den er dokumenteret i migrationens egen kommentar og i
-- docs/gdpr/retention-schedule.md: afholdte måles fra ends_at, annullerede
-- fra cancelled_at. Andet led får derfor 'status = booked'.
--
-- Uændret i øvrigt fra 20260829090200 — kun bookings-blokken er rettet.

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

    -- --- Bookinger (kun TERMINALE) ---------------------------------------
    -- Annullerede bookinger måles fra annulleringen, afholdte fra sluttiden.
    -- En fremtidig aktiv booking røres aldrig. Hændelserne slettes først
    -- (booking_events.booking_id er 'restrict').
    d := retention_days(c.id, 'bookings');
    if d is not null then
      select array_agg(id) into v_ids
        from bookings
        where company_id = c.id
          and ((status = 'cancelled' and cancelled_at < now() - make_interval(days => d))
            or (status = 'booked' and ends_at < now() - make_interval(days => d)));

      if v_ids is not null and array_length(v_ids, 1) > 0 then
        delete from booking_events where booking_id = any(v_ids);
        delete from bookings where id = any(v_ids);
        get diagnostics n = row_count;
        perform record_audit(c.id, 'retention.purged', 'booking', c.id::text, null,
          jsonb_build_object('table', 'bookings', 'deleted', n, 'retention_days', d));
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

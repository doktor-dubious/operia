-- Rettelser efter kodegennemgang 2026-07-20 (Entra-synk + GDPR-anonymisering).
--
--   1. Rollekravet i anonymize_employee gjaldt også når pakke-lukningstriggeren
--      kaldte den: en pakkehåndterer uden manager-rolle kunne ikke udlevere den
--      sidste pakke til en fratrådt medarbejder — hele statusopdateringen blev
--      rullet tilbage. Selve sletningen ligger nu i en intern funktion uden
--      rollekrav, som kun de kontrollerede veje (RPC'en, triggeren og
--      synkroniseringens funktioner) kan nå — den kan ikke kaldes via PostgREST.
--   2. data_manager mistede anonymiserings-retten, da /employees skiftede fra en
--      direkte UPDATE (tilladt af employees_write) til RPC'en, som kun tog
--      manager. data_manager sidestilles med manager her, som på resten af
--      stamdataen.
--   3. Masse-anonymisering var ikke længere alt-eller-intet: klienten kaldte
--      RPC'en i løkke og kunne stoppe halvvejs med nogle medarbejdere slettet og
--      andre ikke. anonymize_employees(uuid[]) kører hele flokken i én
--      transaktion.
--   4. Cron-jobbet lod first_sync_at gælde som alternativ til dry_run_at, så en
--      ÆNDRET opsætning (hvor værnet netop nulstiller dry_run_at) blev anvendt
--      uden at et menneske havde set tallene. En godkendt tørkørsel af den
--      aktuelle opsætning kræves nu altid.
--   5. Feedback-skærmbilleder havde ingen sletningsvej — samme hul som
--      pakkefilerne havde før 20260720130200. DELETE-politik for platform-admins
--      på både rækken og filen; det daglige oprydningsjob fjerner filer hvis
--      feedback-række er slettet.

-- ---------------------------------------------------------------------------
-- 1) Intern anonymisering uden rollekrav (kan ikke nås fra klienten)
-- ---------------------------------------------------------------------------
create or replace function public.anonymize_employee_internal(
  p_employee_id uuid,
  p_label text default 'Anonymiseret medarbejder'
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_had_login boolean;
begin
  select user_id is not null into v_had_login
    from public.employees where id = p_employee_id;
  if not found then
    raise exception 'employee_not_found';
  end if;

  update public.employees
     set full_name = p_label,
         first_name = null,
         last_name = null,
         initials = null,
         email = null,
         phone = null,
         nfc_card_id = null,
         employee_no = null,
         role = null,
         -- Koblingen til personen brydes: rækken må aldrig kunne matches til
         -- en Entra-bruger eller en loginkonto igen.
         external_id = null,
         user_id = null,
         retired_at = null,
         is_active = false,
         anonymized_at = now()
   where id = p_employee_id
     and anonymized_at is null;

  -- Sandt = medarbejderen HAVDE en loginkonto, som skal fjernes separat under
  -- Brugere (auth.users indeholder også navn/e-mail).
  return coalesce(v_had_login, false);
end;
$$;

revoke execute on function public.anonymize_employee_internal(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1+2) RPC'en: kun autorisationsskallen — nu også med data_manager
-- ---------------------------------------------------------------------------
create or replace function public.anonymize_employee(
  p_employee_id uuid,
  p_label text default 'Anonymiseret medarbejder'
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.employees where id = p_employee_id;
  if v_company is null then
    raise exception 'employee_not_found';
  end if;
  -- auth.uid() er null når synkroniseringen kalder med service-role.
  if auth.uid() is not null
     and not public.is_platform_admin()
     and not (v_company = public.current_company_id()
              and public.has_any_role('manager', 'data_manager')) then
    raise exception 'not_authorized';
  end if;
  return public.anonymize_employee_internal(p_employee_id, p_label);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Masse-anonymisering i én transaktion (alt-eller-intet)
-- ---------------------------------------------------------------------------
-- Returnerer antallet der HAVDE en loginkonto (jf. anonymize_employee).
create or replace function public.anonymize_employees(
  p_ids uuid[],
  p_label text default 'Anonymiseret medarbejder'
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_had_login int := 0;
begin
  -- Autorisationen tjekkes pr. medarbejder (virksomheden kan variere); fejler
  -- én, rulles hele kaldet tilbage.
  foreach v_id in array p_ids loop
    if public.anonymize_employee(v_id, p_label) then
      v_had_login := v_had_login + 1;
    end if;
  end loop;
  return v_had_login;
end;
$$;

revoke execute on function public.anonymize_employees(uuid[], text) from public, anon;
grant execute on function public.anonymize_employees(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1) De interne kaldere går uden om rollekravet
-- ---------------------------------------------------------------------------
-- Triggeren kører som den bruger der lukkede pakken — en pakkehåndterer, ikke
-- en manager. Anonymiseringen er systemets beslutning (politikken er slået til
-- af en manager), ikke brugerens, så rollekravet hører ikke til her.
create or replace function public.anonymize_on_parcel_closed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.receiver_employee_id is not null
     and new.status in ('delivered', 'rejected', 'returned')
     and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and exists (
       select 1 from public.employees e
        where e.id = new.receiver_employee_id
          and e.retired_at is not null
          and e.anonymized_at is null
     )
     and not public.employee_has_open_parcels(new.receiver_employee_id) then
    perform public.anonymize_employee_internal(new.receiver_employee_id);
  end if;
  return new;
end;
$$;

create or replace function public.sweep_retired_employees(
  p_company_id uuid,
  p_label text default 'Anonymiseret medarbejder'
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select id from public.employees
     where company_id = p_company_id
       and retired_at is not null
       and anonymized_at is null
  loop
    if not public.employee_has_open_parcels(v_id) then
      perform public.anonymize_employee_internal(v_id, p_label);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function public.retire_employee(
  p_employee_id uuid,
  p_anonymize boolean,
  p_label text default 'Anonymiseret medarbejder'
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not p_anonymize then
    update public.employees set is_active = false where id = p_employee_id;
    return 'deactivated';
  end if;

  if public.employee_has_open_parcels(p_employee_id) then
    select full_name into v_name from public.employees where id = p_employee_id;
    update public.employees
       set is_active = false,
           retired_at = coalesce(retired_at, now()),
           -- Idempotent: gentagne synk må ikke give "EX-EX-EX-".
           full_name = case when v_name like 'EX-%' then v_name else 'EX-' || v_name end
     where id = p_employee_id;
    return 'retired';
  end if;

  perform public.anonymize_employee_internal(p_employee_id, p_label);
  return 'anonymized';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Planlagt synk kræver altid en godkendt tørkørsel af AKTUEL opsætning
-- ---------------------------------------------------------------------------
-- cron.schedule med samme navn erstatter jobbet fra 20260720120300. Eneste
-- ændring: first_sync_at gælder ikke længere som alternativ til dry_run_at —
-- ellers var værnets nulstilling af dry_run_at ved tenant/klient/gruppe-skift
-- virkningsløs, og en forkert gruppe kunne anvendes uset af cron-jobbet.
select cron.schedule('operia-entra-sync', '*/15 * * * *', $job$
do $inner$
declare
  v_key text;
  v_default_interval int;
  r record;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then return; end if;

  select entra_sync_interval_minutes into v_default_interval
    from public.platform_settings
   where entra_enabled
   limit 1;
  if v_default_interval is null then return; end if;

  for r in
    select c.company_id,
           coalesce(c.sync_interval_minutes, v_default_interval) as mins,
           c.last_sync_at
      from public.company_entra_config c
     where c.enabled
       and c.tenant_id is not null
       and c.client_id is not null
       and c.client_secret_set
       and c.dry_run_at is not null
  loop
    if r.last_sync_at is null
       or r.last_sync_at <= now() - make_interval(mins => r.mins) then
      perform net.http_post(
        url := 'https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/entra-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key
        ),
        body := jsonb_build_object('companyId', r.company_id, 'mode', 'apply')
      );
    end if;
  end loop;
end
$inner$;
$job$);

-- ---------------------------------------------------------------------------
-- 5) Sletningsvej for feedback + skærmbilleder (platform-admins)
-- ---------------------------------------------------------------------------
-- Vejen ved en sletteanmodning: platform-admin sletter feedback-rækken; det
-- daglige oprydningsjob fjerner den nu forældreløse fil samme nat.
grant delete on public.feedback to authenticated;

create policy feedback_delete on public.feedback
  for delete to authenticated
  using (public.is_platform_admin());

create policy feedback_screenshot_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'feedback' and public.is_platform_admin());

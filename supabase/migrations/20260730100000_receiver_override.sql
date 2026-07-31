-- Manager-override af modtageren: nogle gange kan den tilsigtede modtager IKKE
-- kvittere — typisk fordi personen har forladt virksomheden (eller er
-- langtidsfraværende), og pakken ellers ville stå i receptionen for evigt (og
-- blokere for GDPR-anonymisering af den fratrådte, jf. employee_has_open_parcels).
--
-- Løsningen er ikke at omskrive historien: pakkens TILSIGTEDE modtager
-- (receiver_employee_id) står urørt, og oveni gemmes hvem der FAKTISK fik
-- pakken plus begrundelsen og hvem der godkendte det. Begge navne kan derfor
-- vises side om side i pakkeoversigten og på pakkelisten.
--
-- Håndhævelsen ligger server-side (CLAUDE.md: browseren er utroværdig): kun
-- manager/parcel_manager i pakkens egen virksomhed — eller platform-admin — kan
-- kalde funktionen, og begrundelsen er påkrævet. Handlingen skriver en egen
-- linje i den uforanderlige parcel_events-log ('receiver_overridden'), som
-- audit_parcel_events-triggeren spejler videre til audit_log som
-- 'parcel.receiver_overridden'.

alter table public.parcels
  -- Den faktiske modtager, når det er en kendt medarbejder. delivered_to
  -- (fritekst) bevares som før, så alt eksisterende visning/rapportering
  -- fortsætter uændret — kolonnen her tilføjer bare koblingen.
  add column if not exists delivered_employee_id uuid
    references public.employees (id) on delete set null,
  add column if not exists receiver_override_reason text,
  add column if not exists receiver_override_by uuid
    references auth.users (id) on delete set null,
  add column if not exists receiver_override_at timestamptz;

create index if not exists parcels_delivered_employee_idx
  on public.parcels (delivered_employee_id);

comment on column public.parcels.delivered_employee_id is
  'Faktisk modtager (medarbejder) ved manager-override; receiver_employee_id forbliver den tilsigtede modtager.';
comment on column public.parcels.receiver_override_reason is
  'Managerens begrundelse for at udlevere til en anden end den tilsigtede modtager.';

-- ---------------------------------------------------------------------------
-- Selve overstyringen. Tager en liste af pakker, så en hel batch (25 pakker til
-- den samme fratrådte medarbejder) kan afsluttes i ét kald og én transaktion.
-- Returnerer antal berørte pakker.
-- ---------------------------------------------------------------------------
create or replace function public.override_parcel_receiver(
  p_parcel_ids uuid[],
  p_delivered_to text,
  p_reason text,
  p_delivered_employee_id uuid default null,
  p_note text default null,
  p_signature_path text default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_companies uuid[];
  v_company uuid;
  v_to text := nullif(btrim(coalesce(p_delivered_to, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_parcel record;
  v_count int := 0;
begin
  if p_parcel_ids is null or array_length(p_parcel_ids, 1) is null then
    raise exception 'no_parcels';
  end if;
  if v_to is null then
    raise exception 'delivered_to_required';
  end if;
  -- Begrundelsen er hele pointen: uden den er der ingen revisionsspor-værdi.
  if v_reason is null then
    raise exception 'reason_required';
  end if;

  select array_agg(distinct company_id) into v_companies
    from public.parcels
   where id = any (p_parcel_ids);
  if v_companies is null then
    raise exception 'parcel_not_found';
  end if;
  if array_length(v_companies, 1) <> 1 then
    raise exception 'mixed_companies';
  end if;
  v_company := v_companies[1];

  if not public.is_platform_admin()
     and not (
       v_company = public.current_company_id()
       and public.has_any_role('manager', 'parcel_manager')
     ) then
    raise exception 'not_authorized';
  end if;

  -- FK-opslag i en definer-funktion omgår RLS, så tenant-tilhør tjekkes her.
  if p_delivered_employee_id is not null and not exists (
    select 1 from public.employees e
     where e.id = p_delivered_employee_id and e.company_id = v_company
  ) then
    raise exception 'employee_not_in_company';
  end if;

  -- Kun pakker der faktisk kan udleveres (samme delmængde som
  -- parcel_transition_allowed tillader → 'delivered'). 'unassigned' har ingen
  -- tilsigtet modtager at overstyre.
  for v_parcel in
    select id, company_id, status, receiver_employee_id
      from public.parcels
     where id = any (p_parcel_ids)
       and company_id = v_company
       and status in ('registered', 'in_storage', 'in_transit', 'in_locker')
     order by registered_at
     for update
  loop
    update public.parcels
       set status = 'delivered',
           delivered_to = v_to,
           delivered_employee_id = p_delivered_employee_id,
           delivered_note = coalesce(v_note, delivered_note),
           delivered_signature_path = coalesce(p_signature_path, delivered_signature_path),
           receiver_override_reason = v_reason,
           receiver_override_by = auth.uid(),
           receiver_override_at = now()
     where id = v_parcel.id;

    -- Egen linje i sporet ud over den 'status_changed' som log_parcel_event
    -- skriver: den fortæller HVORFOR kæden afveg, og af hvem.
    insert into public.parcel_events
      (parcel_id, company_id, event_type, from_status, to_status, actor_user_id, detail)
    values
      (v_parcel.id, v_parcel.company_id, 'receiver_overridden', v_parcel.status, 'delivered', auth.uid(),
       jsonb_build_object(
         'intended_receiver', v_parcel.receiver_employee_id,
         'actual_receiver', p_delivered_employee_id,
         'delivered_to', v_to,
         'reason', v_reason
       ));

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'no_deliverable_parcels';
  end if;

  return v_count;
end;
$$;

revoke execute on function public.override_parcel_receiver(uuid[], text, text, uuid, text, text)
  from public, anon;
grant execute on function public.override_parcel_receiver(uuid[], text, text, uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Logniveau: en overstyring er en undtagelse, ikke rutine — den skal lyse gult
-- i Logs på linje med afvisning/retur. audit_log.level er en genereret kolonne
-- over denne funktion (kun nye rækker beregnes om); klientspejlet er levelOf i
-- web/src/routes/_app/operia.logs.tsx — holdt i sync.
-- ---------------------------------------------------------------------------
create or replace function public.audit_level(p_action text, p_detail jsonb)
returns text language sql immutable as $$
  select case
    when p_action like '%.failed' or p_action like '%\_failed' escape '\'
      or p_action like '%.bounced' or p_action like '%\_bounced' escape '\'
      or p_action = 'data_transfer.spoof_rejected'
      then 'error'
    when p_action = 'import.rejected'
      or p_action like '%.deleted'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or p_action like '%.overridden' or p_action like '%\_overridden' escape '\'
      or p_action like '%.complained' or p_action like '%\_complained' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned'))
      then 'warning'
    else 'success'
  end
$$;

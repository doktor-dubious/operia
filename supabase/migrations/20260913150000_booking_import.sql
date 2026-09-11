-- Import af bookinger fra fil (EVU-krav B-03).
--
-- "Et udtræk fra Dalux kan indlæses uden manuel omformatering af filen."
-- Kolonnemapningen sidder i skærmen; her sidder det, en fil ikke må kunne
-- omgå: opslag af ressource og medarbejder, overlap, låsen på fakturerede
-- bookinger, og at hver oprettelse går gennem de samme RPC'er som et klik —
-- så hændelsesloggen, beskederne og dobbeltbookingsværnet rammer importen
-- præcis som brugerfladen (D-02).
--
-- Idempotens: `external_ref` er filens id for bookingen (Dalux' id, eller
-- hvad kunden nu har). Samme fil to gange giver samme bookinger, ikke dobbelt;
-- en rettet fil retter bookingen. Uden external_ref oprettes altid — det siges
-- i tørkørslen, så ingen importerer den samme fil to gange ved et uheld.
--
-- Tørkørslen (p_apply = false) laver alle opslag og alle kontroller, men
-- skriver intet. Den er svaret på "hvad vil der ske" — og den fanger overlap
-- inden for FILEN, som databasen først ville se række for række.

alter table public.bookings add column if not exists external_ref text
  check (external_ref is null or (char_length(btrim(external_ref)) between 1 and 120 and external_ref !~ '[[:cntrl:]]'));
create unique index if not exists bookings_external_ref_uidx
  on public.bookings (company_id, external_ref) where external_ref is not null;

create or replace function public.import_bookings(
  p_company_id uuid,
  p_rows jsonb,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r jsonb;
  i integer := 0;
  v_ref text; v_res_txt text; v_emp_txt text; v_lvl_txt text; v_title text;
  v_starts timestamptz; v_ends timestamptz; v_all_day boolean; v_count integer;
  v_res uuid; v_emp uuid; v_lvl uuid; v_existing record;
  v_action text; v_reason text; v_id uuid;
  v_created int := 0; v_updated int := 0; v_unchanged int := 0; v_skipped int := 0;
  v_out jsonb := '[]'::jsonb;
  v_seen_refs text[] := '{}';
  v_tz text;
begin
  if not public.can_manage_bookings(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_required' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'too_many_rows' using errcode = 'P0001';
  end if;
  -- Tidspunkterne i filen er VÆGUR-tid i kundens tidszone — ikke browserens.
  -- Den, der importerer, kan sidde hvor som helst; lokalet står i Danmark.
  select coalesce(timezone, 'Europe/Copenhagen') into v_tz from public.companies where id = p_company_id;

  -- Rækker accepteret i DENNE kørsel, til overlap inden for filen.
  create temporary table if not exists _import_accepted (
    resource_id uuid, starts_at timestamptz, ends_at timestamptz, ref text
  ) on commit drop;
  -- 'delete' uden where afvises af safeupdate på klientrollen; truncate er ok.
  truncate _import_accepted;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_action := null; v_reason := null; v_id := null; v_res := null; v_emp := null; v_lvl := null;
    v_ref := nullif(btrim(coalesce(r->>'external_ref', '')), '');
    v_res_txt := nullif(btrim(coalesce(r->>'resource', '')), '');
    v_emp_txt := nullif(btrim(coalesce(r->>'employee', '')), '');
    v_lvl_txt := nullif(btrim(coalesce(r->>'participant_level', '')), '');
    v_title := nullif(btrim(coalesce(r->>'title', '')), '');
    v_all_day := coalesce((r->>'all_day')::boolean, false);
    v_count := nullif(r->>'participant_count', '')::integer;
    begin
      v_starts := (r->>'starts_at')::timestamp at time zone v_tz;
      v_ends := (r->>'ends_at')::timestamp at time zone v_tz;
    exception when others then
      v_starts := null; v_ends := null;
    end;

    -- 1) Opslag. Ressourcen på navn (foldet) eller Dalux-id; medarbejderen på
    --    nummer, e-mail, initialer eller navn — i den rækkefølge, fordi
    --    nummeret er entydigt og navnet ikke er.
    if v_res_txt is not null then
      select id into v_res from public.booking_resources
       where company_id = p_company_id and is_active
         and (dalux_room_id = v_res_txt or public.fold_name(name) = public.fold_name(v_res_txt))
       order by (dalux_room_id = v_res_txt) desc limit 1;
    end if;
    if v_emp_txt is not null then
      select id into v_emp from public.employees
       where company_id = p_company_id and is_active
         and (employee_no = v_emp_txt or lower(email) = lower(v_emp_txt)
              or initials_folded = public.fold_name(v_emp_txt)
              or full_name_folded = public.fold_name(v_emp_txt))
       order by (employee_no = v_emp_txt) desc, (lower(email) = lower(v_emp_txt)) desc limit 1;
    end if;
    if v_lvl_txt is not null then
      select id into v_lvl from public.booking_participant_levels
       where company_id = p_company_id and public.fold_name(name) = public.fold_name(v_lvl_txt) limit 1;
    end if;

    -- 2) Kontroller, i den rækkefølge en læser forstår dem.
    if v_starts is null or v_ends is null then v_reason := 'bad_time';
    elsif v_ends <= v_starts then v_reason := 'bad_interval';
    elsif v_res_txt is null then v_reason := 'resource_missing';
    elsif v_res is null then v_reason := 'resource_unknown';
    -- En booking har altid en medarbejder (create_booking kræver det): den er
    -- den, lokalet er booket til, og den, bekræftelsen sendes til (A-04).
    elsif v_emp_txt is null then v_reason := 'employee_missing';
    elsif v_emp is null then v_reason := 'employee_unknown';
    elsif v_lvl_txt is not null and v_lvl is null then v_reason := 'level_unknown';
    elsif v_ref is not null and v_ref = any(v_seen_refs) then v_reason := 'duplicate_ref_in_file';
    end if;

    -- 3) Findes den allerede (på external_ref)?
    v_existing := null;
    if v_reason is null and v_ref is not null then
      select * into v_existing from public.bookings
       where company_id = p_company_id and external_ref = v_ref;
      if found then
        if v_existing.invoiced_at is not null then v_reason := 'invoiced_locked';
        elsif v_existing.status = 'cancelled' then v_reason := 'cancelled_locked';
        elsif v_existing.resource_id = v_res
          and v_existing.employee_id is not distinct from v_emp
          and v_existing.starts_at = v_starts and v_existing.ends_at = v_ends
          and v_existing.all_day = v_all_day
          and v_existing.title is not distinct from v_title
          and v_existing.participant_count is not distinct from v_count
          and v_existing.participant_level_id is not distinct from v_lvl then
          v_action := 'unchanged';
        else
          v_action := 'update';
        end if;
      end if;
    end if;
    if v_reason is null and v_action is null then v_action := 'create'; end if;

    -- 4) Overlap: mod basen (uden bookingen selv) og mod filens egne rækker.
    if v_reason is null and v_action in ('create', 'update') then
      if exists (
        select 1 from public.bookings b
        where b.company_id = p_company_id and b.resource_id = v_res and b.status = 'booked'
          and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(v_starts, v_ends, '[)')
          and (v_existing is null or b.id <> v_existing.id)
      ) or exists (
        select 1 from _import_accepted a
        where a.resource_id = v_res and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(v_starts, v_ends, '[)')
      ) then
        v_reason := 'overlap';
      end if;
    end if;

    -- 5) Anvend — gennem de samme RPC'er som brugerfladen.
    if v_reason is null and p_apply then
      begin
        if v_action = 'create' then
          v_id := public.create_booking(v_res, v_emp, v_starts, v_ends, v_title, v_all_day, v_count, v_lvl);
          if v_ref is not null then
            update public.bookings set external_ref = v_ref where id = v_id;
          end if;
        elsif v_action = 'update' then
          perform public.update_booking(v_existing.id, v_res, v_emp, v_starts, v_ends, v_title, v_all_day, v_count, v_lvl);
          v_id := v_existing.id;
        else
          v_id := v_existing.id;
        end if;
      exception
        when exclusion_violation then v_reason := 'overlap';
        when others then
          -- RPC'ernes egne koder (booking_retro_not_allowed, employee_inactive, …)
          -- videregives som de er; en ukendt fejl bliver 'internal'.
          v_reason := case when sqlerrm ~ '^[a-z_]+$' then sqlerrm else 'internal' end;
      end;
    end if;

    if v_reason is not null then
      v_skipped := v_skipped + 1;
      v_action := 'skip';
    else
      if v_action = 'create' then v_created := v_created + 1;
      elsif v_action = 'update' then v_updated := v_updated + 1;
      else v_unchanged := v_unchanged + 1; end if;
      if v_action <> 'unchanged' then
        insert into _import_accepted values (v_res, v_starts, v_ends, v_ref);
      end if;
      if v_ref is not null then v_seen_refs := v_seen_refs || v_ref; end if;
    end if;

    v_out := v_out || jsonb_build_object(
      'row', i, 'action', v_action, 'reason', v_reason, 'booking_id', v_id,
      'external_ref', v_ref,
      'resource', (select name from public.booking_resources where id = v_res),
      'employee', (select full_name from public.employees where id = v_emp),
      'starts_at', v_starts, 'ends_at', v_ends);
  end loop;

  if p_apply then
    perform public.record_audit(p_company_id, 'booking.imported', 'booking', p_company_id::text,
      null, jsonb_build_object('rows', i, 'created', v_created, 'updated', v_updated,
                               'unchanged', v_unchanged, 'skipped', v_skipped));
  end if;

  return jsonb_build_object(
    'applied', p_apply, 'rows', i,
    'created', v_created, 'updated', v_updated, 'unchanged', v_unchanged, 'skipped', v_skipped,
    'results', v_out);
end;
$fn$;
revoke all on function public.import_bookings(uuid, jsonb, boolean) from public;
grant execute on function public.import_bookings(uuid, jsonb, boolean) to authenticated;

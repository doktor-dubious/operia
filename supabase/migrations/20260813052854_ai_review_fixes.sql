-- Rettelser fra code review 2026-08-13 (AI-labellæsning):
--
--   1) audit_category() mistede kortlægninger undervejs: 20260724140000
--      (auth-login) tabte general/asset_flow/handheld, og 20260812104500
--      (ai-audit) tabte derefter auth. Værre: sidstnævntes backfill GENBEREGNEDE
--      de lagrede kolonner og omklassificerede dermed historiske
--      auth/general/asset_flow/handheld-rækker til 'other'. Definitionen her er
--      FORENINGEN af alle hidtidige kortlægninger, og backfillen regner de
--      ramte rækker rigtige igen (action står urørt, så intet er tabt).
--      Klient-spejlet categoryOf i operia.logs.tsx havde hele tiden alle
--      kortlægninger — det var databasen, der var bagud.
--
--   2) ai_match_label_fields: i afsender-blokken lå score-tærsklen og
--      "ikke identisk med input"-filteret EFTER limit 3 — en identisk tidligere
--      afsender optog altså en topplads og blev derefter smidt væk, så et
--      kvalificeret forslag på 4.-pladsen aldrig blev vist. Filtrene ligger nu
--      før limit, som modtager-/fragtfirma-blokkene altid har gjort.
--
--   3) Ydelse: hvert scan foldede input og medarbejdernavne forfra pr. række,
--      og afsender-aggregatet læste hele parcels-historikken uden indeks.
--      Nu: foldede input hejses op i variabler, employees får lagrede foldede
--      kolonner (fold_name er immutable), og parcels får et delindeks til
--      aggregatet. Beslutningsreglerne (tærskler, margin, auto) er URØRTE.

-- ---------------------------------------------------------------------------
-- 1) audit_category: foreningen af alle kortlægninger + reparations-backfill
-- ---------------------------------------------------------------------------
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $$
  select case split_part(coalesce(p_action, ''), '.', 1)
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
    else 'other'
  end
$$;

-- Samme fremgangsmåde som 20260716100000/20260812104500: audit_log er
-- append-only, indholdet (action/detail) ændres ikke — kun de lagrede
-- genererede kolonner genberegnes, så triggeren slås fra i netop denne
-- transaktion.
alter table public.audit_log disable trigger audit_log_immutable;
update public.audit_log set action = action
  where category is distinct from public.audit_category(action);
alter table public.audit_log enable trigger audit_log_immutable;

-- ---------------------------------------------------------------------------
-- 2+3) Matchning: lighed på ALLEREDE foldede strenge + foldede kolonner
-- ---------------------------------------------------------------------------
-- name_similarity foldede begge argumenter pr. kald — i modtager-blokken blev
-- p_receiver altså foldet igen for HVER medarbejder. name_score_folded er
-- name_similarity uden foldningen: varianterne (uden mellemrum, OCR-cifre som
-- bogstaver) er de samme, kalderen leverer bare færdigfoldede strenge.
create or replace function public.name_score_folded(p_a text, p_b text)
returns real
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  with v as (
    select
      p_a as a, p_b as b,
      replace(p_a, ' ', '') as ca, replace(p_b, ' ', '') as cb,
      translate(p_a, '01358', 'olebs') as oa, translate(p_b, '01358', 'olebs') as ob
  )
  select case
    when a is null or b is null then 0::real
    else greatest(
      public.name_score(a, b),
      public.name_score(ca, cb),
      public.name_score(oa, ob)
    )
  end
  from v;
$$;

comment on function public.name_score_folded(text, text) is
  'Lighed 0–1 mellem to ALLEREDE foldede navne (fold_name), inkl. varianterne uden mellemrum og med OCR-cifre læst som bogstaver. name_similarity() = denne + foldning.';

grant execute on function public.name_score_folded(text, text) to authenticated;

-- Uændret adfærd — definitionen udtrykkes bare gennem hjælperen ovenfor.
create or replace function public.name_similarity(p_a text, p_b text)
returns real
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select public.name_score_folded(public.fold_name(p_a), public.fold_name(p_b));
$$;

-- Foldningen af medarbejdernavne flytter fra pr.-opslag (regexp/translate for
-- hver række, hvert scan) til skrivetid: fold_name er immutable, så kolonnerne
-- kan lagres genereret og følger altid med navnet.
alter table public.employees
  add column full_name_folded text generated always as (public.fold_name(full_name)) stored,
  add column initials_folded  text generated always as (public.fold_name(initials)) stored;

comment on column public.employees.full_name_folded is
  'fold_name(full_name), lagret — bruges af ai_match_label_fields, så matchningen ikke folder hvert navn forfra ved hvert scan.';

-- Afsender-aggregatet (gruppér virksomhedens tidligere afsendere) læste hele
-- parcels-historikken som heap scan. Delindekset dækker præcis aggregatets
-- behov (company_id, sender, max(registered_at)) — index-only i stedet for
-- tabelscan, og det vokser ikke med pakker uden afsender.
create index if not exists parcels_company_sender_idx
  on public.parcels (company_id, sender)
  include (registered_at)
  where sender is not null;

-- Selve matchningen. Beslutningsregler, tærskler og svarform er identiske med
-- 20260807132720 — ændringerne er:
--   * foldede input i variabler (v_receiver/v_carrier/v_sender),
--   * employees' lagrede foldede kolonner + name_score_folded,
--   * fragtfirmaets foldning hejst i en lateral (én gang pr. række, ikke én
--     gang pr. token-sammenligning),
--   * afsender: tærskel + "ikke identisk"-filter FØR limit 3 (fejlrettelsen).
create or replace function public.ai_match_label_fields(
  p_company_id uuid,
  p_receiver text default null,
  p_carrier text default null,
  p_sender text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  -- Tærskler. Modtageren er den dyre fejl (pakke + besked til den forkerte),
  -- så den kræver både høj score og klar afstand til nummer to.
  c_receiver_auto   constant real := 0.86;
  c_receiver_margin constant real := 0.08;
  c_receiver_floor  constant real := 0.45;  -- under denne er det ikke en kandidat
  c_carrier_auto    constant real := 0.72;  -- kort liste, billig fejl, synlig i dropdown
  c_carrier_margin  constant real := 0.08;
  c_sender_suggest  constant real := 0.78;  -- foreslås kun, snapper aldrig
  v_receiver text := public.fold_name(p_receiver);
  v_carrier  text := public.fold_name(p_carrier);
  v_sender   text := public.fold_name(p_sender);
  v_result jsonb := '{}'::jsonb;
  v_rec jsonb;
  v_best real;
  v_second real;
begin
  -- ---- modtager -----------------------------------------------------------
  if v_receiver is not null then
    with scored as (
      select
        e.id, e.full_name, e.initials, e.email, e.phone, e.department_id,
        d.name as department_name,
        greatest(
          public.name_score_folded(e.full_name_folded, v_receiver),
          case
            when e.initials_folded is null then 0::real
            else public.name_score_folded(e.initials_folded, v_receiver)
          end
        ) as score
      from public.employees e
      left join public.departments d on d.id = e.department_id
      where e.company_id = p_company_id
        and e.is_active
    ),
    ranked as (
      select * from scored where score >= c_receiver_floor
      order by score desc, full_name
      limit 5
    )
    select
      jsonb_agg(jsonb_build_object(
        'id', id, 'full_name', full_name, 'initials', initials,
        'email', email, 'phone', phone, 'department_id', department_id,
        'department_name', department_name, 'score', round(score::numeric, 4)
      ) order by score desc, full_name),
      max(score),
      -- næstbedste score; null når der kun er én kandidat
      (select max(score) from (select score from ranked order by score desc offset 1) s)
    into v_rec, v_best, v_second
    from ranked;

    v_result := v_result || jsonb_build_object('receiver', jsonb_build_object(
      'raw', p_receiver,
      'candidates', coalesce(v_rec, '[]'::jsonb),
      'auto', (
        v_best is not null
        and v_best >= c_receiver_auto
        and (v_second is null or v_best - v_second >= c_receiver_margin)
      )
    ));
  end if;

  -- ---- fragtfirma ---------------------------------------------------------
  -- Ud over lighed bruges her ORD-PRÆFIKS: fragtfirmaer står på labelen med
  -- støj omkring sig ("dao365", "PostNord Danmark A/S", "GLS Denmark"). Et ord
  -- på labelen der begynder med firmanavnet (eller omvendt) tæller som et
  -- match, vægtet efter hvor meget af ordet navnet dækker. Mindst 3 tegn, så
  -- korte stumper ikke rammer tilfældigt.
  if v_carrier is not null then
    with scored as (
      select
        c.id,
        c.name,
        greatest(
          public.name_score_folded(cf.folded, v_carrier),
          coalesce((
            select max(0.75::real + 0.25::real
                       * least(length(tok), length(cf.folded))::real
                       / greatest(length(tok), length(cf.folded))::real)
            from unnest(string_to_array(v_carrier, ' ')) as tok
            where length(tok) >= 3
              and length(cf.folded) >= 3
              and (tok like cf.folded || '%'
                   or cf.folded like tok || '%')
          ), 0::real)
        ) as score
      from public.carriers c
      cross join lateral (select public.fold_name(c.name) as folded) cf
      where c.company_id = p_company_id and c.is_active
    ),
    ranked as (
      select * from scored where score >= c_carrier_auto
      order by score desc, name
      limit 3
    )
    select
      jsonb_agg(jsonb_build_object('id', id, 'name', name,
                                   'score', round(score::numeric, 4))
                order by score desc, name),
      max(score),
      (select max(score) from (select score from ranked order by score desc offset 1) s)
    into v_rec, v_best, v_second
    from ranked;

    v_result := v_result || jsonb_build_object('carrier', jsonb_build_object(
      'raw', p_carrier,
      'candidates', coalesce(v_rec, '[]'::jsonb),
      -- To fragtfirmaer der ligner hinanden lige meget ⇒ intet automatisk valg;
      -- feltet står tomt, og dropdown'en er lige ved siden af.
      'auto', v_best is not null and (v_second is null or v_best - v_second >= c_carrier_margin)
    ));
  end if;

  -- ---- afsender -----------------------------------------------------------
  -- Afsender er fri tekst uden stamdata. Et forkert "match" ville stille slå
  -- en ny afsender sammen med en gammel og forurene statistikken — derfor
  -- ALDRIG automatik her, kun et forslag klienten kan tilbyde.
  if v_sender is not null then
    select jsonb_agg(jsonb_build_object('name', sender,
                                        'score', round(score::numeric, 4))
                     order by score desc, sender)
    into v_rec
    from (
      -- Tærskel og "ikke identisk med input" SKAL stå før limit: en identisk
      -- tidligere afsender må ikke optage en af de tre pladser og fortrænge
      -- et kvalificeret nært forslag.
      select t.sender, t.score
      from (
        select s.sender,
               public.fold_name(s.sender) as folded,
               public.name_score_folded(public.fold_name(s.sender), v_sender) as score
        from (
          select p.sender
          from public.parcels p
          where p.company_id = p_company_id and p.sender is not null
          group by p.sender
          order by count(*) desc, max(p.registered_at) desc
          limit 200
        ) s
      ) t
      where t.score >= c_sender_suggest
        and t.folded is distinct from v_sender
      order by t.score desc, t.sender
      limit 3
    ) x;

    v_result := v_result || jsonb_build_object('sender', jsonb_build_object(
      'raw', p_sender,
      'candidates', coalesce(v_rec, '[]'::jsonb),
      'auto', false
    ));
  end if;

  return v_result;
end;
$$;

-- AI-label-matching (fase 1, deterministisk) — "fortolkningslaget" oven på
-- AI-aflæsningen af pakkelabelen.
--
-- Problemet: en label kan stave modtageren "AAse Østergård", "Åse Ostergård"
-- eller "Åse Østegård", mens medarbejderen hedder "Åse Østergård". Det samme
-- gælder fragtfirmaet ("PostNorb" → PostNord) og afsenderen.
--
-- Løsningen her bruger INGEN AI. Den er ren tekstbehandling i to trin:
--   1) fold_name(): dansk foldning — æ→ae, ø→oe, å→aa, accenter fjernes, alt
--      ikke-alfanumerisk bliver mellemrum. "AAse Østergård" og "Åse Ostergård"
--      folder begge til "aase oestergaard" og matcher dermed EKSAKT. Det klarer
--      hovedparten af OCR-støjen alene.
--   2) name_similarity(): trigram (pg_trgm) ELLER normaliseret Levenshtein
--      (fuzzystrmatch) oven på foldningen — fanger de ægte stavefejl
--      ("Østegård" mangler et r).
--
-- Beslutningsreglen er vigtigere end scoren: en kandidat vælges kun automatisk
-- når den både er god nok (score ≥ tærskel) OG klart bedre end nummer to
-- (margin). Ellers returneres kandidaterne, og et menneske vælger. En forkert
-- modtager sender både pakken og ankomstbeskeden til den forkerte person —
-- det må aldrig være systemets gæt.
--
-- Sporingsnummeret matches ALDRIG fuzzy: det er pakkens identitet, og et
-- "rettet" ciffer gør pakken uopsporlig. Kun struktur-oprydning i prompten.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- ---------------------------------------------------------------------------
-- 1) Dansk foldning
-- ---------------------------------------------------------------------------
-- Rækkefølgen er ikke tilfældig: å SKAL blive til "aa" før accenter fjernes,
-- ellers ville "Åse" folde til "ase" og aldrig matche "AAse".
create or replace function public.fold_name(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    trim(
      regexp_replace(
        translate(
          replace(replace(replace(replace(replace(replace(replace(replace(
            lower(coalesce(p_text, '')),
            'æ', 'ae'), 'ø', 'oe'), 'å', 'aa'),
            'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'),
            'ß', 'ss'), 'ð', 'd'),
          'áàâãªéèêëíìîïóòôõºúùûýÿñçšžþ',
          'aaaaaeeeeiiiiooooouuuyyncszt'
        ),
        '[^a-z0-9]+', ' ', 'g'
      )
    ),
    ''
  );
$$;

comment on function public.fold_name(text) is
  'Kanoniserer et navn til sammenligning: dansk/nordisk foldning (æ→ae, ø→oe, å→aa), accenter fjernes, ikke-alfanumerisk bliver mellemrum.';

-- ---------------------------------------------------------------------------
-- 2) Lighed 0–1
-- ---------------------------------------------------------------------------
-- Tre mål på ALLEREDE foldede strenge; det bedste vinder, fordi de fanger hver
-- sin type fejl:
--
--   * Normaliseret Levenshtein — enkelt-tegns-fejl ("postnorb" vs "postnord" =
--     1 fejl ud af 8 tegn = 0,875). Bærer hovedparten af arbejdet.
--
--   * Trigram GANGET MED LÆNGDEFORHOLDET — fanger ordombytning ("Østergård
--     Åse"), hvor Levenshtein er blind. Længdefaktoren er ikke pynt: pg_trgm
--     giver similarity('soeren soerensen', 'soerensen') = 1,0, fordi det korte
--     ords trigrammer er en delmængde af det langes. Uden faktoren ville et
--     bart efternavn score som et perfekt match og blive valgt automatisk —
--     med to Sørensen'er i huset den præcis forkerte opførsel.
--
--   * Token-overlap — hvor mange hele ord er fælles, målt mod det længste af
--     de to navne. Giver et efternavn alene ~0,5: nok til at blive FORESLÅET,
--     aldrig nok til at blive valgt automatisk.
create or replace function public.name_score(p_a text, p_b text)
returns real
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select case
    when p_a is null or p_b is null or p_a = '' or p_b = '' then 0::real
    when p_a = p_b then 1::real
    else greatest(
      -- levenshtein() afviser strenge over 255 tegn; så langt er intet navn.
      case
        when length(p_a) > 255 or length(p_b) > 255 then 0::real
        else 1::real - extensions.levenshtein(p_a, p_b)::real
                       / greatest(length(p_a), length(p_b))::real
      end,
      extensions.similarity(p_a, p_b)
        * least(length(p_a), length(p_b))::real / greatest(length(p_a), length(p_b))::real,
      (
        select cardinality(array(select unnest(ta) intersect select unnest(tb)))::real
               / greatest(cardinality(ta), cardinality(tb))::real
        from (select string_to_array(p_a, ' ') as ta, string_to_array(p_b, ' ') as tb) t
      )
    )
  end;
$$;

comment on function public.name_score(text, text) is
  'Lighed 0–1 mellem to ALLEREDE foldede strenge: den bedste af normaliseret Levenshtein, længdevægtet trigram og token-overlap. Brug name_similarity() til rå input.';

-- Offentlig indgang: folder først, og sammenligner desuden to varianter, fordi
-- de er gratis og kun kan hæve scoren (greatest):
--   * uden mellemrum — "G L S" ↔ "GLS", "POST NORD" ↔ "PostNord",
--   * med typiske OCR-cifre læst tilbage som bogstaver (0→o, 1→l, 5→s, 8→b) —
--     "Ase 0stergard" ↔ "Åse Østergård". Kun her, aldrig i fold_name selv:
--     ellers ville et ægte tal i et navn ("Dao365") blive ødelagt.
create or replace function public.name_similarity(p_a text, p_b text)
returns real
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  with f as (
    select public.fold_name(p_a) as a, public.fold_name(p_b) as b
  ),
  v as (
    select
      a, b,
      replace(a, ' ', '') as ca, replace(b, ' ', '') as cb,
      translate(a, '01358', 'olebs') as oa, translate(b, '01358', 'olebs') as ob
    from f
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

comment on function public.name_similarity(text, text) is
  'Lighed 0–1 mellem to navne: fold_name() + name_score(), også på formen uden mellemrum og med OCR-cifre læst som bogstaver.';

-- ---------------------------------------------------------------------------
-- 3) Kundens tilvalg
-- ---------------------------------------------------------------------------
-- Matchningen kan slås fra pr. virksomhed (Konfigurér → Integrationer). Slået
-- fra opfører label-læsningen sig præcis som før: kun eksakte/entydige match.
alter table public.company_ai_config
  add column match_enabled boolean not null default true;

comment on column public.company_ai_config.match_enabled is
  'Fortolkningslag: match AI-aflæste navne mod medarbejdere/fragtfirmaer/afsendere med foldning + fuzzy-lighed.';

-- Revisionssporet skal også fange netop denne ændring — ellers ville et skift
-- af match_enabled gå ulogget forbi (triggeren returnerer tidligt, når
-- provider/model står uændret).
create or replace function public.audit_company_ai_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and new.provider is not distinct from old.provider
     and new.model is not distinct from old.model
     and new.match_enabled is not distinct from old.match_enabled then
    return new;
  end if;
  perform public.record_audit(new.company_id, 'ai.config_updated', 'ai_config',
    new.company_id::text, null,
    jsonb_build_object('provider', new.provider, 'model', new.model,
                       'match_enabled', new.match_enabled));
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Selve matchningen
-- ---------------------------------------------------------------------------
-- Ét kald for alle tre felter: klienterne (web + håndterminal) skal dele
-- præcis samme regler, og en ekstra rundtur pr. felt er spildt tid i en
-- scanne-arbejdsgang.
--
-- SECURITY INVOKER med vilje: RLS på employees/carriers/parcels afgør hvad
-- kalderen må se, så funktionen kan ikke lække på tværs af virksomheder.
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
  v_result jsonb := '{}'::jsonb;
  v_rec jsonb;
  v_best real;
  v_second real;
begin
  -- ---- modtager -----------------------------------------------------------
  if public.fold_name(p_receiver) is not null then
    with scored as (
      select
        e.id, e.full_name, e.initials, e.email, e.phone, e.department_id,
        d.name as department_name,
        greatest(
          public.name_similarity(e.full_name, p_receiver),
          case
            when e.initials is null then 0::real
            else public.name_similarity(e.initials, p_receiver)
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
  if public.fold_name(p_carrier) is not null then
    with scored as (
      select
        c.id,
        c.name,
        greatest(
          public.name_similarity(c.name, p_carrier),
          coalesce((
            select max(0.75::real + 0.25::real
                       * least(length(tok), length(public.fold_name(c.name)))::real
                       / greatest(length(tok), length(public.fold_name(c.name)))::real)
            from unnest(string_to_array(public.fold_name(p_carrier), ' ')) as tok
            where length(tok) >= 3
              and length(public.fold_name(c.name)) >= 3
              and (tok like public.fold_name(c.name) || '%'
                   or public.fold_name(c.name) like tok || '%')
          ), 0::real)
        ) as score
      from public.carriers c
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
  if public.fold_name(p_sender) is not null then
    select jsonb_agg(jsonb_build_object('name', sender,
                                        'score', round(score::numeric, 4))
                     order by score desc, sender)
    into v_rec
    from (
      select s.sender, public.name_similarity(s.sender, p_sender) as score
      from (
        select p.sender
        from public.parcels p
        where p.company_id = p_company_id and p.sender is not null
        group by p.sender
        order by count(*) desc, max(p.registered_at) desc
        limit 200
      ) s
      order by score desc, s.sender
      limit 3
    ) t
    where score >= c_sender_suggest and public.fold_name(sender) is distinct from public.fold_name(p_sender);

    v_result := v_result || jsonb_build_object('sender', jsonb_build_object(
      'raw', p_sender,
      'candidates', coalesce(v_rec, '[]'::jsonb),
      'auto', false
    ));
  end if;

  return v_result;
end;
$$;

comment on function public.ai_match_label_fields(uuid, text, text, text) is
  'Fortolkningslag over AI-label-aflæsningen: matcher modtager/fragtfirma/afsender mod virksomhedens egne data. auto=true betyder ét entydigt match klienten må udfylde direkte; ellers er candidates forslag til et menneske.';

grant execute on function public.fold_name(text) to authenticated;
grant execute on function public.name_similarity(text, text) to authenticated;
grant execute on function public.ai_match_label_fields(uuid, text, text, text) to authenticated;

-- Prisliste med tidsafgrænsede takster (EVU-krav C-05).
--
-- C-01 vil danne en fakturakladde efter "lokale × antal dage × pris". De to
-- første faktorer findes: bookingen kender sin ressource og sit tidsrum. Den
-- tredje findes ikke — en ressource har ingen pris overhovedet, og en
-- tilkøbsydelse har ét enkelt tal uden gyldighedsperiode. Uden denne tabel er
-- C-01 aritmetik uden operander.
--
-- Kravets acceptkriterie er todelt: prislisten skal kunne opdateres UDEN
-- udvikling, og en ændring må IKKE ramme allerede fakturerede bookinger. Det
-- første er en tabel med et skærmbillede; det andet er grunden til, at taksten
-- har en gyldighedsperiode og ikke bare et felt der overskrives. En pris, der
-- overskrives, tager historien med sig — og fakturagrundlaget for sidste
-- kvartal med den.
--
-- ENHEDEN er en kolonne og ikke en antagelse. Kunden har endnu ikke svaret på,
-- om "dag" betyder kalenderdage eller hverdage, om timepris skal bruges, eller
-- om kursistniveau prissættes pr. person eller pr. person pr. dag (spørgsmål
-- 4, 5 og 6 i docs/evu-booking-kravstatus.md). Alle fem svar kan rummes som
-- DATA i `unit`, så svaret bliver en indtastning frem for en migration.
--
-- Momskoden er med som et frit felt af samme grund: den hører måske til pr.
-- ydelse, måske pr. linje, måske pr. debitor (spørgsmål 5). Et nullable
-- tekstfelt koster ingenting nu og kan strammes til en opslagstabel, når
-- svaret findes. Det er bevidst IKKE en enum: en forkert gættet enum er dyrere
-- at rette end en tom kolonne.

create table if not exists public.booking_tariffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,

  -- Hvad taksten hænger på. Tre slags, fordi kravet nævner tre: ressourcen
  -- (C-01/C-05), tilkøbsydelsen (C-05/C-06) og kursistniveauet (C-07).
  scope text not null check (scope in ('resource', 'service', 'level')),
  resource_id uuid references public.booking_resources(id) on delete cascade,
  service_id uuid references public.booking_services(id) on delete cascade,
  level_id uuid references public.booking_participant_levels(id) on delete cascade,
  -- Ét mål at slå op på, uanset hvilken af de tre der er sat.
  target_id uuid generated always as (coalesce(resource_id, service_id, level_id)) stored,

  unit text not null check (unit in ('day', 'hour', 'person', 'person_day', 'flat')),
  amount numeric(12,2) not null check (amount >= 0),
  -- Valutaen er virksomhedens (companies.default_currency). En takst i en
  -- anden valuta end resten af bookingen ville skulle omregnes på et
  -- tidspunkt, og der findes ingen kurs i systemet.
  vat_code text,
  valid_from date not null default current_date,
  valid_to date,                       -- null = løbende
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),

  constraint booking_tariffs_one_target check (
    (scope = 'resource' and resource_id is not null and service_id is null and level_id is null)
    or (scope = 'service' and service_id is not null and resource_id is null and level_id is null)
    or (scope = 'level' and level_id is not null and resource_id is null and service_id is null)
  ),
  constraint booking_tariffs_period check (valid_to is null or valid_to >= valid_from),
  constraint booking_tariffs_vat_sane check (
    vat_code is null or (char_length(btrim(vat_code)) between 1 and 16 and vat_code !~ '[[:cntrl:]]')
  ),
  constraint booking_tariffs_note_sane check (
    note is null or (char_length(note) <= 300 and note !~ '[[:cntrl:]]')
  )
);

-- To takster for samme mål og samme enhed må ikke gælde samtidig — ellers har
-- prisopslaget i C-01 ikke ét svar, og "hvad kostede lokalet den 14.?" bliver
-- et skøn. Samme mekanik som dobbeltbookingsværnet: et exclusion-constraint,
-- håndhævet af basen, ikke af skærmbilledet.
--
-- Bemærk at FORSKELLIGE enheder gerne må overlappe: et lokale kan udmærket
-- have både en dagspris og en pris pr. kursist, og C-07 forudsætter det.
alter table public.booking_tariffs
  drop constraint if exists booking_tariffs_no_overlap;
alter table public.booking_tariffs
  add constraint booking_tariffs_no_overlap exclude using gist (
    company_id with =,
    target_id with =,
    unit with =,
    daterange(valid_from, valid_to, '[]') with &&
  );

create index if not exists booking_tariffs_lookup_idx
  on public.booking_tariffs (company_id, target_id, unit, valid_from desc);

alter table public.booking_tariffs enable row level security;

drop policy if exists booking_tariffs_select on public.booking_tariffs;
create policy booking_tariffs_select on public.booking_tariffs
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

-- Skrivning følger stamdata-mønsteret fra ressourcer og ydelser: manager eller
-- booking_manager, håndhævet af politikken.
drop policy if exists booking_tariffs_write on public.booking_tariffs;
create policy booking_tariffs_write on public.booking_tariffs
  for all to authenticated
  using (public.can_manage_bookings(company_id))
  with check (public.can_manage_bookings(company_id));

-- Rettighederne på tabelniveau. Supabases standardrettigheder i public giver
-- kun REFERENCES/TRIGGER/TRUNCATE til rollerne, så uden disse linjer svarer
-- PostgREST 403 på selv en læsning, RLS-politikken ovenfor til trods — RLS
-- filtrerer rækker, den giver ikke adgang til tabellen.
--
-- TRUNCATE tages samtidig fra klientrollerne, af samme grund som på
-- logtabellerne (20260910180000): hverken RLS eller triggere fanger den, og en
-- prisliste er grundlaget for det, der er faktureret.
grant select, insert, update, delete on public.booking_tariffs to authenticated;
grant select, insert, update, delete on public.booking_tariffs to service_role;
revoke truncate, trigger on public.booking_tariffs from anon, authenticated;
revoke select, insert, update, delete on public.booking_tariffs from anon;

-- ---------------------------------------------------------------------------
-- Vagt: normalisering + at målet hører til samme virksomhed
-- ---------------------------------------------------------------------------
-- Fremmednøglerne siger kun at ressourcen findes, ikke at den er KUNDENS. Uden
-- dette tjek kunne en manager hænge en takst på en anden virksomheds lokale og
-- dermed læse dens navn ud af sin egen prisliste.
create or replace function public.booking_tariffs_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner uuid;
begin
  new.vat_code := nullif(btrim(coalesce(new.vat_code, '')), '');
  new.note := nullif(btrim(coalesce(new.note, '')), '');

  -- Er scope og mål slet ikke i familie, så lad check-constraintet svare: to
  -- vagter om samme regel giver to forskellige fejlbeskeder for samme fejl.
  if (new.scope = 'resource' and new.resource_id is null)
     or (new.scope = 'service' and new.service_id is null)
     or (new.scope = 'level' and new.level_id is null) then
    return new;
  end if;

  if new.scope = 'resource' then
    select company_id into v_owner from public.booking_resources where id = new.resource_id;
  elsif new.scope = 'service' then
    select company_id into v_owner from public.booking_services where id = new.service_id;
  else
    select company_id into v_owner from public.booking_participant_levels where id = new.level_id;
  end if;

  if v_owner is null or v_owner <> new.company_id then
    raise exception 'tariff_target_other_company' using errcode = 'P0001';
  end if;
  return new;
end;
$fn$;

drop trigger if exists booking_tariffs_guard_trg on public.booking_tariffs;
create trigger booking_tariffs_guard_trg
  before insert or update on public.booking_tariffs
  for each row execute function public.booking_tariffs_guard();

-- ---------------------------------------------------------------------------
-- Spor
-- ---------------------------------------------------------------------------
-- Prisen er grundlaget for alt, hvad der senere faktureres, så hver ændring
-- skal kunne findes igen. Beløb og enhed er ikke personoplysninger og må gerne
-- stå i den uforanderlige log.
create or replace function public.audit_booking_tariffs()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit(new.company_id, 'booking_tariff.created', 'booking_tariff',
      new.id::text, null,
      jsonb_build_object('scope', new.scope, 'target_id', new.target_id, 'unit', new.unit,
                         'amount', new.amount, 'valid_from', new.valid_from, 'valid_to', new.valid_to));
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.record_audit(new.company_id, 'booking_tariff.updated', 'booking_tariff',
      new.id::text, null,
      jsonb_build_object('scope', new.scope, 'target_id', new.target_id,
                         'from_unit', old.unit, 'to_unit', new.unit,
                         'from_amount', old.amount, 'to_amount', new.amount,
                         'from_valid_from', old.valid_from, 'to_valid_from', new.valid_from,
                         'from_valid_to', old.valid_to, 'to_valid_to', new.valid_to));
    return new;
  else
    perform public.record_audit(old.company_id, 'booking_tariff.deleted', 'booking_tariff',
      old.id::text, null,
      jsonb_build_object('scope', old.scope, 'target_id', old.target_id, 'unit', old.unit,
                         'amount', old.amount));
    return old;
  end if;
end;
$fn$;

drop trigger if exists audit_booking_tariffs_trg on public.booking_tariffs;
create trigger audit_booking_tariffs_trg
  after insert or update or delete on public.booking_tariffs
  for each row execute function public.audit_booking_tariffs();

-- ---------------------------------------------------------------------------
-- Prisopslaget
-- ---------------------------------------------------------------------------
-- Én funktion, som både skærmbilledet og C-01's kladdegenerering bruger, så
-- der kun findes ét svar på "hvad koster det her den dag".
--
-- `p_on` er den dato, prisen skal gælde for — bookingens STARTDATO, ikke dags
-- dato. En booking, der er afholdt i marts, skal faktureres til marts-prisen,
-- også hvis nogen kigger på den i november.
create or replace function public.booking_tariffs_on(
  p_company_id uuid,
  p_target_id uuid,
  p_on date default current_date
)
returns setof public.booking_tariffs
language sql
stable
as $fn$
  select t.*
  from public.booking_tariffs t
  where t.company_id = p_company_id
    and t.target_id = p_target_id
    and t.valid_from <= p_on
    and (t.valid_to is null or t.valid_to >= p_on)
  order by t.unit
$fn$;

grant execute on function public.booking_tariffs_on(uuid, uuid, date) to authenticated;

comment on table public.booking_tariffs is
  'Tidsafgrænsede takster pr. ressource, tilkøbsydelse og kursistniveau (EVU C-05). Enheden er data, ikke antagelse — se migrationens hoved.';

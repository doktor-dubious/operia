-- Slack-bruger-id pr. medarbejder: en VALGFRI tilsidesættelse.
--
-- Slack-kanalen finder normalt personen ved at slå e-mailen op
-- (users.lookupByEmail), og det passer sig selv: den der får en Slack-konto
-- bliver automatisk modtagelig, og den der forlader workspacet fejler rent.
--
-- Problemet er de tilfælde hvor Slack-kontoen bruger en ANDEN adresse end den i
-- Operia (privat adresse, alias, konto fra før SSO, ekstern konsulent). Så kan
-- personen aldrig nås — og manageren kan ikke rette op, for employees.email
-- ejes af HR-importen/Entra-synkroniseringen og overskrives ved næste kørsel.
-- Uden dette felt er der altså ingen vej udenom. Med det er der én.
--
-- Feltet er tomt som standard og skal ikke vedligeholdes: udfyldes det, springes
-- opslaget over (og dermed også Slacks Tier 2-rate limit på ~20 opslag/minut).
--
-- HR-importen rører det ALDRIG: employee-import.ts skriver kun de felter der
-- står i 'owned', og dette er ikke et af dem. SAR-udtrækket får det gratis,
-- fordi rpc'en bruger to_jsonb(emp) frem for en kolonneliste.

alter table public.employees
  add column slack_user_id text;

-- Slack-medlems-id'er er 'U' (eller 'W' på Enterprise Grid) efterfulgt af
-- versaler/cifre. Checken fanger den forventelige fejl — at nogen indsætter et
-- visningsnavn, en e-mail eller et kanal-id (C…) i stedet for medlems-id'et.
-- Bevidst rummelig i længden: Slack har udvidet id-længden før.
alter table public.employees
  add constraint employees_slack_user_id_format
  check (slack_user_id is null or slack_user_id ~ '^[UW][A-Z0-9]{6,20}$');

comment on column public.employees.slack_user_id is
  'Valgfri tilsidesættelse af Slack-opslaget. Tom = slå op på e-mail. Ejes af mennesker, ikke af HR-importen.';

-- Normalisér ved skrivning, uanset hvilken klient der skriver: et indsat id
-- med mellemrum eller små bogstaver skal ikke afvises af checken ovenfor, men
-- bare rettes. Tom streng bliver til null, så "ryddet" og "aldrig sat" er
-- samme tilstand.
create or replace function public.normalize_employee_slack_id()
returns trigger language plpgsql set search_path = public as $$
begin
  new.slack_user_id := nullif(upper(btrim(coalesce(new.slack_user_id, ''))), '');
  return new;
end;
$$;

create trigger employees_normalize_slack_id
  before insert or update of slack_user_id on public.employees
  for each row execute function public.normalize_employee_slack_id();

-- ---------------------------------------------------------------------------
-- GDPR: identifikatoren skal med i anonymiseringen
-- ---------------------------------------------------------------------------
-- anonymize_employee_internal nulstiller en EKSPLICIT kolonneliste. Et nyt
-- personhenførbart id der ikke står på listen ville overleve en sletning og
-- gøre rækken matchbar til en Slack-konto bagefter — præcis det funktionen
-- findes for at forhindre. Kopieret fra 20260720150000 med slack_user_id
-- tilføjet; resten er uændret.
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
         -- en Entra-bruger, en loginkonto eller en Slack-konto igen.
         external_id = null,
         slack_user_id = null,
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

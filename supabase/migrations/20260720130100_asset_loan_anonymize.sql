-- Låneren anonymiseres når udlånet lukkes.
--
-- asset_loans er en selvstændig kontaktkopi (navn, adresse, e-mail, telefon) og
-- har ikke engang en employee_id — anonymisering af en medarbejder kunne derfor
-- aldrig nå den. Så længe udlånet er åbent er kontaktoplysningerne nødvendige
-- (påmindelser, rykkere); når aktivet er afleveret, er formålet opfyldt og
-- oplysningerne slettes (GDPR art. 5(1)(e) — opbevaringsbegrænsning).
--
-- Selve udlånshistorikken bevares: hvilket aktiv, hvornår, af hvem det blev
-- udlånt og modtaget (lent_by/returned_by er medarbejdere med login, ikke
-- låneren). Kun lånerens identitet fjernes.

alter table public.asset_loans
  add column anonymized_at timestamptz;

comment on column public.asset_loans.anonymized_at is
  'Lånerens kontaktoplysninger er slettet (sat da udlånet blev afsluttet).';

-- Kontaktkravet gælder kun så længe der ER en låner at kontakte. Uden denne
-- lempelse ville check-constraint'en blokere selve anonymiseringen.
alter table public.asset_loans
  drop constraint asset_loans_contact_required;

alter table public.asset_loans
  add constraint asset_loans_contact_required check (
    anonymized_at is not null
    or nullif(btrim(to_email), '') is not null
    or nullif(btrim(to_phone), '') is not null
  );

-- ---------------------------------------------------------------------------
-- Anonymisering af ét udlån
-- ---------------------------------------------------------------------------
-- to_name er not null med en non-empty-check, så den får en etiket i stedet for
-- null. Bounce-markeringen ryddes med: den knytter sig til den slettede adresse.
create or replace function public.anonymize_asset_loan(
  p_loan_id uuid,
  p_label text default 'Anonymiseret låner'
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
begin
  select company_id into v_company
    from public.asset_loans where id = p_loan_id and anonymized_at is null;
  if v_company is null then
    return; -- ukendt eller allerede anonymiseret
  end if;

  update public.asset_loans
     set to_name = p_label,
         to_address = null,
         to_email = null,
         to_phone = null,
         bounced_at = null,
         bounce_reason = null,
         anonymized_at = now()
   where id = p_loan_id;

  -- Afsendelsesloggen gemmer den faktisk brugte adresse/mobilnummer. Selve
  -- rækkerne bevares (leveringsdokumentation), men modtageren fjernes.
  update public.asset_loan_notifications
     set recipient = null
   where loan_id = p_loan_id and recipient is not null;

  perform public.record_audit(v_company, 'asset.loan_anonymized', 'asset_loan',
    p_loan_id::text, null, jsonb_build_object('loan_id', p_loan_id));
end;
$$;

revoke execute on function public.anonymize_asset_loan(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: så snart udlånet markeres afleveret
-- ---------------------------------------------------------------------------
-- Ingen rekursion: anonymize_asset_loan opdaterer rækken igen, men da ændrer
-- returned_at sig ikke, og betingelsen er falsk anden gang.
create or replace function public.anonymize_loan_on_return()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.returned_at is null and new.returned_at is not null
     and new.anonymized_at is null then
    perform public.anonymize_asset_loan(new.id);
  end if;
  return new;
end;
$$;

create trigger asset_loans_anonymize_on_return
  after update of returned_at on public.asset_loans
  for each row execute function public.anonymize_loan_on_return();

-- ---------------------------------------------------------------------------
-- Oprydning af allerede afsluttede udlån
-- ---------------------------------------------------------------------------
create or replace function public.sweep_returned_loans(p_company_id uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_count int := 0;
begin
  for v_id in
    select id from public.asset_loans
     where returned_at is not null
       and anonymized_at is null
       and (p_company_id is null or company_id = p_company_id)
  loop
    perform public.anonymize_asset_loan(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.sweep_returned_loans(uuid) from public, anon, authenticated;

-- Historikken ryddes én gang her; fremover klarer triggeren det løbende.
select public.sweep_returned_loans();

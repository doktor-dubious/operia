-- GDPR-kontakter og databehandleraftale pr. kunde.
--
-- Baggrund (docs/gdpr/): to forpligtelser i databehandleraftalen kan ikke
-- opfyldes i dag, fordi der ikke findes ét eneste kontaktfelt på companies:
--
--   * Art. 28(2): underdatabehandlere må først skiftes efter skriftligt varsel
--     til den dataansvarlige — hvem varsles?
--   * Art. 33(2): et brud skal meddeles den dataansvarlige uden unødig
--     forsinkelse (DCA lover 24 timer) — hvem ringes op kl. 03?
--
-- Derfor to kontaktblokke, plus en registrering af hvilken version af
-- databehandleraftalen kunden har underskrevet og hvornår. Det sidste er
-- dokumentationen for at aftalen var på plads FØR behandlingen begyndte
-- (Art. 28(3)) — samme bevisføringsmønster som company_ai_config's
-- disclosure_accepted_at/version.
--
-- Ejerskab:
--   * Kontakterne er KUNDENS egne oplysninger → managers vedligeholder dem selv
--     (Konfigurér → Databeskyttelse), platform-admins kan også rette dem.
--   * Aftale-registreringen er DCA's kontraktdokumentation → kun platform-admin
--     (samme trigger-værn som navn/CVR og forsendelsesmodellen).
--
-- Synlighed: companies_select gør rækken læsbar for alle i virksomheden, og RLS
-- kan ikke skelne kolonner. Kontakterne er virksomhedens interne
-- funktionspostkasser (DPO/sikkerhed), ikke følsomme personoplysninger, så det
-- er et bevidst valg at lade dem være læsbare på linje med virksomhedens navn.

alter table public.companies
  -- Databeskyttelseskontakt: modtager varsel om nye underdatabehandlere og er
  -- indgangen for indsigts-/sletteanmodninger kunden videresender til DCA.
  add column privacy_contact_name text,
  add column privacy_contact_email text,
  add column privacy_contact_phone text,
  -- Sikkerhedskontakt: modtager underretning om brud på persondatasikkerheden.
  -- Skal kunne nås uden for arbejdstid — derfor et telefonfelt ved siden af.
  add column security_contact_name text,
  add column security_contact_email text,
  add column security_contact_phone text,
  -- Databehandleraftalen: version (fx 'DCA-DPA-1.0' / Datatilsynets
  -- standardkontrakt), underskriftsdato og hvem der underskrev hos kunden.
  add column dpa_version text,
  add column dpa_signed_at timestamptz,
  add column dpa_signed_by text;

-- En halv registrering er værre end ingen: en dato uden version og underskriver
-- kan ikke bruges som dokumentation over for en tilsynsmyndighed.
alter table public.companies
  add constraint companies_dpa_record_complete
  check (
    dpa_signed_at is null
    or (nullif(btrim(coalesce(dpa_version, '')), '') is not null
        and nullif(btrim(coalesce(dpa_signed_by, '')), '') is not null)
  );

comment on column public.companies.privacy_contact_email is
  'Modtager varsel om nye underdatabehandlere (GDPR art. 28(2)). Se docs/gdpr/subprocessors.md §3.';
comment on column public.companies.security_contact_email is
  'Modtager underretning om brud på persondatasikkerheden (GDPR art. 33(2)). Se docs/gdpr/incident-response.md.';
comment on column public.companies.dpa_version is
  'Version af databehandleraftalen kunden har underskrevet. Kun platform-admins kan sætte den.';

-- 1) Aftale-registreringen tilføjes de DCA-ejede kolonner.
--    Funktionen genudgives i sin helhed (samme mønster som 20260712145032) —
--    listen over DCA-ejede kolonner skal stå ét sted.
create or replace function public.protect_company_dca_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.is_active is distinct from old.is_active
      or new.shipping_model is distinct from old.shipping_model
      or new.shipping_margin_percent is distinct from old.shipping_margin_percent
      or new.shipping_margin_fixed is distinct from old.shipping_margin_fixed
      or new.shipping_byoc_subscription is distinct from old.shipping_byoc_subscription
      or new.shipping_byoc_fee is distinct from old.shipping_byoc_fee
      -- Databehandleraftalen er kontrakten mellem DCA og kunden; en manager må
      -- ikke kunne skrive sin egen aftale ind (eller slette beviset for den).
      or new.dpa_version is distinct from old.dpa_version
      or new.dpa_signed_at is distinct from old.dpa_signed_at
      or new.dpa_signed_by is distinct from old.dpa_signed_by)
    -- Service-rollen (Edge Functions) har ingen auth.uid() og er undtaget;
    -- anon når aldrig hertil (ingen update-politik for anon).
    and auth.uid() is not null
    and not public.is_platform_admin() then
    raise exception 'Kun platform-admins kan ændre virksomhedens status, forsendelsesmodel og databehandleraftale.';
  end if;
  return new;
end;
$$;

-- 2) Audit. audit_log er uforanderlig og videresendes til kundens log-drain, så
--    selve kontaktoplysningerne (navn, e-mail, telefon = personoplysninger) må
--    ALDRIG i loggen — kun HVILKE felter der blev ændret. Aftaleversion og
--    -dato er kontraktdata, ikke personoplysninger, og logges derfor som
--    værdier; underskriverens navn gør ikke.
create or replace function public.audit_company_privacy()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed text[] := '{}';
begin
  if new.privacy_contact_name is distinct from old.privacy_contact_name
     then changed := array_append(changed, 'privacy_contact_name'); end if;
  if new.privacy_contact_email is distinct from old.privacy_contact_email
     then changed := array_append(changed, 'privacy_contact_email'); end if;
  if new.privacy_contact_phone is distinct from old.privacy_contact_phone
     then changed := array_append(changed, 'privacy_contact_phone'); end if;
  if new.security_contact_name is distinct from old.security_contact_name
     then changed := array_append(changed, 'security_contact_name'); end if;
  if new.security_contact_email is distinct from old.security_contact_email
     then changed := array_append(changed, 'security_contact_email'); end if;
  if new.security_contact_phone is distinct from old.security_contact_phone
     then changed := array_append(changed, 'security_contact_phone'); end if;

  if array_length(changed, 1) is not null then
    perform public.record_audit(new.id, 'privacy.contacts_changed', 'company', new.id::text, null,
      jsonb_build_object(
        'fields', to_jsonb(changed),
        -- Er der overhovedet en brudkontakt tilbage? Det er det spørgsmål en
        -- gennemgang stiller, og det kan besvares uden at gemme adressen.
        'security_contact_set', nullif(btrim(coalesce(new.security_contact_email, '')), '') is not null,
        'privacy_contact_set', nullif(btrim(coalesce(new.privacy_contact_email, '')), '') is not null));
  end if;

  if (new.dpa_version, new.dpa_signed_at) is distinct from (old.dpa_version, old.dpa_signed_at)
     or new.dpa_signed_by is distinct from old.dpa_signed_by then
    perform public.record_audit(new.id, 'privacy.dpa_changed', 'company', new.id::text, null,
      jsonb_build_object(
        'from', jsonb_build_object('version', old.dpa_version, 'signed_at', old.dpa_signed_at),
        'to', jsonb_build_object('version', new.dpa_version, 'signed_at', new.dpa_signed_at),
        'signatory_changed', new.dpa_signed_by is distinct from old.dpa_signed_by));
  end if;

  return new;
end;
$$;

create trigger audit_company_privacy_trg
  after update on public.companies
  for each row execute function public.audit_company_privacy();

-- 3) Taksonomi: privacy.* er sin egen kategori. Samme begrundelse som 'ai' —
--    en GDPR-gennemgang skal kunne trække netop de hændelser ud alene.
--    Klient-spejlet er categoryOf/CATEGORIES i operia.logs.tsx — hold i sync.
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
    when 'privacy'        then 'compliance'
    else 'other'
  end
$$;

-- Ingen eksisterende rækker har action 'privacy.*', så der er intet at
-- genberegne — men samme værn som de tidligere taksonomi-migrationer, hvis
-- funktionen skulle have været forældet i mellemtiden.
alter table public.audit_log disable trigger audit_log_immutable;
update public.audit_log set action = action
  where category is distinct from public.audit_category(action);
alter table public.audit_log enable trigger audit_log_immutable;

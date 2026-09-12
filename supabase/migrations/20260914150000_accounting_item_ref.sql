-- Regnskabsfelterne gjort systemuafhængige (EVU C-02).
--
-- Mønstret "typestandard pr. linjetype + valgfri undtagelse på tingen selv" er
-- det samme for ethvert regnskabssystem — produkt i e-conomic og Dinero, vare
-- eller finanskonto i Business Central og Navision Stat. Kolonnerne hed
-- derimod economic_*, og det ville have været den forkerte antagelse at bære
-- videre, når kunde nr. to kommer med et andet system. Omdøbt nu, mens intet
-- afhænger af navnene: én kunde har ét regnskabssystem, så ét sæt kolonner er
-- nok — det er etiketten i skærmen, der skal følge systemet, ikke skemaet.
--
-- Debitorreferencen bliver tekst: e-conomic bruger et heltal, Business Central
-- en tekstkode. Adapteren kender sit systems form.
--
-- Skrevet så den kan køres igen på en halvt anvendt base: hver omdøbning
-- tjekker først, om kolonnen stadig hedder det gamle.

create or replace function pg_temp.rename_if(p_table text, p_old text, p_new text) returns void
language plpgsql as $fn$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = p_table and column_name = p_old) then
    execute format('alter table public.%I rename column %I to %I', p_table, p_old, p_new);
  end if;
end $fn$;

select pg_temp.rename_if('booking_services', 'economic_product_no', 'accounting_item_ref');
select pg_temp.rename_if('booking_categories', 'economic_product_no', 'accounting_item_ref');
select pg_temp.rename_if('booking_participant_levels', 'economic_product_no', 'accounting_item_ref');

select pg_temp.rename_if('company_accounting_config', 'economic_customer_number', 'accounting_debtor_ref');
select pg_temp.rename_if('company_accounting_config', 'economic_product_room', 'accounting_item_room');
select pg_temp.rename_if('company_accounting_config', 'economic_product_participants', 'accounting_item_participants');
select pg_temp.rename_if('company_accounting_config', 'economic_product_service', 'accounting_item_service');
select pg_temp.rename_if('company_accounting_config', 'economic_auto_book', 'accounting_auto_book');

-- Heltal → tekst. Det gamle check-constraint (> 0) er et heltalsudtryk og skal
-- væk FØR typeskiftet; navnet findes dynamisk, fordi det er autogenereret.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
    where con.conrelid = 'public.company_accounting_config'::regclass
      and con.contype = 'c' and a.attname = 'accounting_debtor_ref'
  loop
    execute format('alter table public.company_accounting_config drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.company_accounting_config
  alter column accounting_debtor_ref type text using accounting_debtor_ref::text;
alter table public.company_accounting_config
  add constraint company_accounting_config_accounting_debtor_ref_check
  check (accounting_debtor_ref is null or (char_length(btrim(accounting_debtor_ref)) between 1 and 25 and accounting_debtor_ref !~ '[[:cntrl:]]'));

-- Statussen 'assigned' hedder nu "Tildelt" i UI'et (før: "I brug") — så
-- importen skal også acceptere den tekst. De gamle etiketter bevares som
-- synonymer, så eksisterende CSV-filer stadig virker. Klientspejlet er
-- ASSET_STATUS_SYNONYMS i web/src/lib/module-import.ts — hold de to i sync.
-- Ellers uændret fra 20260717090000.

create or replace function public.asset_status_from_text(p_text text)
returns public.asset_status language sql immutable as $$
  select case lower(btrim(coalesce(p_text, '')))
    when 'in_stock'       then 'in_stock'
    when 'in stock'       then 'in_stock'
    when 'på lager'       then 'in_stock'
    when 'pa lager'       then 'in_stock'
    when 'assigned'       then 'assigned'
    when 'in use'         then 'assigned'
    when 'i brug'         then 'assigned'
    when 'tildelt'        then 'assigned'
    when 'on_loan'        then 'on_loan'
    when 'on loan'        then 'on_loan'
    when 'lent out'       then 'on_loan'
    when 'udlånt'         then 'on_loan'
    when 'udlaant'        then 'on_loan'
    when 'service'        then 'service'
    when 'repair'         then 'service'
    when 'til service'    then 'service'
    when 'til reparation' then 'service'
    when 'retired'        then 'retired'
    when 'udfaset'        then 'retired'
    when 'udgået'         then 'retired'
    when 'udgaaet'        then 'retired'
    else null
  end::public.asset_status
$$;

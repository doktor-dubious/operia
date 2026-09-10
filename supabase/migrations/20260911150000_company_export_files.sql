-- Filerne med i kundeudtrækket (EVU-krav F-08, sidste led).
--
-- Rækkerne blev udleveret 2026-09-11; filerne — tilstandsfotos, underskrifter,
-- aktivbilag, designbilleder — stod kun som sti og metadata. For en kunde, der
-- forlader systemet, er underskriften på en udlevering ikke pynt: den ER
-- beviset for, at pakken blev afleveret. En pakke uden dem er ikke et fuldt
-- udtræk.
--
-- Selve hentningen sker i browseren mod Storage, hvor læsepolitikkerne allerede
-- er mappe-afgrænsede pr. virksomhed (`(storage.foldername(name))[1] =
-- current_company_id() or is_platform_admin()`). Der er derfor ingen ny
-- adgangsvej at åbne her — kun sporet skal kunne fortælle, hvor mange filer der
-- fulgte med.
--
-- Signaturen udvides derfor med p_files. Den GAMLE signatur droppes først:
-- `create or replace` med en ekstra parameter danner en OVERLOAD, og PostgREST
-- svarer PGRST203 på et kald, den så ikke kan skelne.

drop function if exists public.log_company_export(uuid, text[], integer, integer);

create or replace function public.log_company_export(
  p_company_id uuid,
  p_groups text[],
  p_tables integer,
  p_rows integer,
  p_files integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_groups text[];
begin
  if not public.company_export_allowed(p_company_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Gruppenavnene hvidlistes, præcis som eksportens tabelnavne: loggen er
  -- uforanderlig og videresendes til kundens log drains, så intet af det, en
  -- klient har skrevet frit, må lande i den.
  select coalesce(array_agg(distinct c.grp order by c.grp), '{}'::text[])
    into v_groups
  from public.company_export_catalog() c
  where c.grp = any(coalesce(p_groups, '{}'::text[]));

  perform public.record_audit(
    p_company_id,
    'privacy.full_export',
    'company',
    p_company_id::text,
    null,
    jsonb_build_object(
      'groups', to_jsonb(v_groups),
      'tables', greatest(coalesce(p_tables, 0), 0),
      'rows', greatest(coalesce(p_rows, 0), 0),
      'files', greatest(coalesce(p_files, 0), 0)
    )
  );
end;
$fn$;

revoke all on function public.log_company_export(uuid, text[], integer, integer, integer) from public;
grant execute on function public.log_company_export(uuid, text[], integer, integer, integer) to authenticated;

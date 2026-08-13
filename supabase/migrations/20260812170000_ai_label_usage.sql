-- Forbrug af AI-labellæsning pr. model (Platform → Kunder → Forbrug).
--
-- Kilden er revisionssporet: hver aflæsning skriver en 'ai.label_read'-række
-- (20260812104500_ai_label_read_audit.sql). Der findes ikke — og skal ikke
-- findes — en separat forbrugstabel: audit_log er uforanderlig, hvilket er
-- præcis den egenskab et faktureringsgrundlag skal have.
--
-- KUN outcome='ok' tælles. Alt andet er afvist før eller under udbyderkaldet
-- (ikke bekræftet, forkert filtype, model uden vision, udbyder nede …) og har
-- ikke leveret et resultat, kunden kan betale for. Rækkerne bliver stående i
-- sporet — de tælles bare ikke med her.
--
-- Grupperingen sker i basen frem for i browseren: det er én forespørgsel i
-- stedet for N, og audit-rækker skal ikke hentes ud af huset for at blive talt.
--
-- SECURITY INVOKER: RLS på audit_log afgør adgangen (egen virksomhed eller
-- platform-admin) — funktionen udvider ikke, hvad kalderen må se.
create or replace function public.ai_label_usage(
  p_company_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (model text, reads bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(detail->>'model', 'unknown') as model, count(*)::bigint as reads
  from public.audit_log
  where action = 'ai.label_read'
    and company_id = p_company_id
    and detail->>'outcome' = 'ok'
    and (p_from is null or created_at >= p_from)
    and (p_to is null or created_at < p_to)
  group by 1
  order by 1;
$$;

revoke execute on function public.ai_label_usage(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.ai_label_usage(uuid, timestamptz, timestamptz) to authenticated;

-- audit_level: hændelser der ender på '_deleted' er også sletninger.
--
-- Fundet ved test af sletningsvejen for pakkedokumentation (20260814190000):
-- 'parcel.document_deleted' blev klassificeret 'success'. Det gør
-- 'asset.document_deleted' også — og har gjort det siden 20260801180000, hvis
-- kommentar tværtimod lover niveau 'warning'.
--
-- Årsagen er mønsteret: `like '%.deleted'` kræver et LITERALT punktum lige før
-- "deleted", og de to handlinger ender på "_deleted" (punktummet står tidligere,
-- efter 'asset'/'parcel'). Funktionen har allerede escapede tvillinge-mønstre
-- for netop dette for '_failed', '_bounced', '_overridden' og '_complained' —
-- '_deleted' manglede.
--
-- Konsekvens uden rettelsen: sletning af bevismateriale (et foto eller en
-- fritekstnote med persondata) står i Logs som en almindelig succes-hændelse og
-- fanges ikke af det ugentlige gennemsyn på advarsels-/fejlniveau
-- (docs/gdpr/incident-response.md §7) — præcis den handling der SKAL falde i
-- øjnene.

create or replace function public.audit_level(p_action text, p_detail jsonb default null)
returns text language sql immutable as $$
  select case
    when p_action = 'ai.label_read' then
      case
        when coalesce(p_detail->>'outcome', '') = 'ok' then 'success'
        when coalesce(p_detail->>'outcome', '') in (
          'integration_disabled', 'not_configured', 'not_allowed', 'not_accepted',
          'model_no_vision', 'forbidden', 'refused', 'image_too_large',
          'unsupported_media_type', 'rate_limited'
        ) then 'warning'
        else 'error'
      end
    when p_action = 'ai.disclosure_withdrawn' then 'warning'
    when p_action = 'parcel.removed'
      or p_action like '%.failed' or p_action like '%\_failed' escape '\'
      or p_action like '%.bounced' or p_action like '%\_bounced' escape '\'
      or p_action = 'data_transfer.spoof_rejected'
      then 'error'
    when p_action = 'import.rejected'
      or p_action = 'user.impersonated'
      or p_action like '%.deleted' or p_action like '%\_deleted' escape '\'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or p_action like '%.written\_off' escape '\'
      or p_action like '%.overridden' or p_action like '%\_overridden' escape '\'
      or p_action like '%.complained' or p_action like '%\_complained' escape '\'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned', 'removed'))
      then 'warning'
    else 'success'
  end
$$;

-- Genberegn de lagrede (stored generated) niveauer for rækker født under den
-- gamle definition. Samme fremgangsmåde som 20260716100000/20260812104500:
-- audit_log er append-only, indholdet ændres ikke — kun den genererede kolonne.
alter table public.audit_log disable trigger audit_log_immutable;
update public.audit_log set action = action
  where level is distinct from public.audit_level(action, detail);
alter table public.audit_log enable trigger audit_log_immutable;

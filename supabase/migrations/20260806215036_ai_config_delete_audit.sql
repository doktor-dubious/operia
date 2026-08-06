-- Revision af AI-konfigurationen: DELETE er både grantet og tilladt af RLS-
-- skrivepolitikken (for all), men audit-triggeren dækkede kun insert/update —
-- at FJERNE konfigurationen efterlod altså intet spor, i strid med NIS2-
-- princippet om at enhver konfigurationsændring logges (20260806163530).
-- Nu logges sletning som 'ai.config_removed'.

create or replace function public.audit_company_ai_config()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.record_audit(old.company_id, 'ai.config_removed', 'ai_config',
      old.company_id::text, null,
      jsonb_build_object('provider', old.provider, 'model', old.model));
    return old;
  end if;
  if tg_op = 'UPDATE'
     and new.provider is not distinct from old.provider
     and new.model is not distinct from old.model then
    return new;
  end if;
  perform public.record_audit(new.company_id, 'ai.config_updated', 'ai_config',
    new.company_id::text, null,
    jsonb_build_object('provider', new.provider, 'model', new.model));
  return new;
end;
$$;

drop trigger if exists company_ai_config_audit on public.company_ai_config;
create trigger company_ai_config_audit
  after insert or update or delete on public.company_ai_config
  for each row execute function public.audit_company_ai_config();

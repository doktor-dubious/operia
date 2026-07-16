-- Eksport-kørsler logges i samme append-only import_runs-tabel som importerne,
-- så Import/Eksport-loggen viser begge dele. Udvid status-domænet med
-- 'exported' (created/updated/... forbliver 0 for en eksport; rows_total
-- holder antal eksporterede rækker).
alter table public.import_runs
  drop constraint import_runs_status_check;

alter table public.import_runs
  add constraint import_runs_status_check
  check (status in ('applied', 'rejected', 'failed', 'exported'));

-- Log en audit-hændelse når der modtages feedback, så den dukker op i
-- Operia → Logs og videresendes til konfigurerede log drains.

create or replace function public.audit_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- company_id sættes bevidst til NULL: audit_log_select åbner ellers rækken
  -- for kundens EGNE managers, og posten bærer afsenderen (actor_user_id).
  -- Feedback går til DCA og må ikke kunne spores tilbage til afsenderen af
  -- kundens ledelse — det ville kvæle ærlig feedback. Virksomheden ligger i
  -- detail, så platform-admins stadig kan se hvem den kom fra.
  -- Beskeden logges IKKE: indholdet hører kun hjemme i public.feedback.
  perform public.record_audit(
    null,
    'feedback.received',
    'feedback',
    new.id::text,
    new.kind,
    jsonb_build_object('kind', new.kind, 'company_id', new.company_id, 'page', new.page_path),
    new.user_id
  );
  return new;
end;
$$;

create trigger feedback_audit
  after insert on public.feedback
  for each row execute function public.audit_feedback();

-- Kontakt-Operia-dialogen på Konfigurér → Produkter & funktioner: kunden kan
-- bede om adgang til et produkt eller en funktion, de ikke har. Henvendelsen
-- lander i DCA's eksisterende feedback-indbakke frem for i en ny tabel — samme
-- RLS (indsend i eget navn, læs kun som platform-admin), samme audit-spor.
--
-- 'access' er derfor en tredje slags feedback, og 'subject' bærer hvad der
-- bedes om (produkt-/funktionsnøgle + navn), så beskeden kan læses uden at
-- gætte ud fra fritekst.

alter table public.feedback
  drop constraint feedback_kind_check;

alter table public.feedback
  add constraint feedback_kind_check check (kind in ('issue', 'idea', 'access'));

alter table public.feedback
  add column subject text;

-- Audit-hændelsen får emnet med i detail. Det er en produktnøgle, ikke
-- persondata, så den må gerne ligge i det uforanderlige audit_log — beskeden
-- bliver stadig kun i public.feedback.
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
    coalesce(new.kind || ': ' || new.subject, new.kind),
    jsonb_build_object(
      'kind', new.kind,
      'subject', new.subject,
      'company_id', new.company_id,
      'page', new.page_path
    ),
    new.user_id
  );
  return new;
end;
$$;

-- Feedback fra brugerne til DCA (Feedback-knappen øverst til højre): et problem
-- ("issue") eller en idé ("idea"), med valgfrit skærmbillede og den side den
-- blev sendt fra. Skrives af enhver logget ind bruger; læses af platform-admins
-- (det er DCA's indbakke, ikke kundens).

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('issue', 'idea')),
  message text not null,
  screenshot_path text, -- privat 'feedback'-bucket: <user_id>/<tid>.<ext>
  page_path text, -- hvor i appen feedbacken blev sendt fra
  created_at timestamptz not null default now()
);

create index feedback_created_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- Indsend: enhver logget ind bruger, men kun i eget navn (user_id = auth.uid()),
-- så en bruger ikke kan lægge feedback i en andens navn.
create policy feedback_insert on public.feedback
  for insert to authenticated
  with check (user_id = auth.uid());

-- Læs: kun platform-admins (DCA). Feedback er til leverandøren.
create policy feedback_select on public.feedback
  for select to authenticated
  using (public.is_platform_admin());

revoke update, delete on public.feedback from anon, authenticated;
grant select, insert on public.feedback to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: privat bucket til vedhæftede skærmbilleder.
-- Sti-konvention: <user_id>/<tid>.<ext> — RLS binder mappen til afsenderen.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('feedback', 'feedback', false)
on conflict (id) do nothing;

create policy feedback_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy feedback_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'feedback'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_platform_admin()
    )
  );

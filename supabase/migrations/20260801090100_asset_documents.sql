-- Aktiv-flowet, del 2: dokumentation (noter + fotos) knyttet til et aktiv,
-- tilføjet over tid — spejlet efter parcel_documents. Append-only evidens:
-- hver post har hvem/hvornår og logges i aktivets hændelseshistorik.
--
-- Filerne ligger i den private 'asset-photos'-bucket under
-- <company_id>/<asset_id>/<fil> (RLS binder første mappe til tenant'en).

create table public.asset_documents (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  storage_path text,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- I modsætning til parcel_documents kan en post være en ren note (uden foto)
  -- — men aldrig helt tom.
  constraint asset_documents_content_required
    check (storage_path is not null or nullif(btrim(note), '') is not null)
);

create index asset_documents_asset_idx on public.asset_documents (asset_id, created_at);
create index asset_documents_company_idx on public.asset_documents (company_id, created_at);

-- FK-opslag omgår RLS, så tenant-tilhør valideres eksplicit (som parcels_guard).
create or replace function public.asset_documents_guard()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.assets a
    where a.id = new.asset_id and a.company_id = new.company_id
  ) then
    raise exception 'Aktivet tilhører ikke virksomheden';
  end if;
  return new;
end;
$$;

create trigger asset_documents_guard
  before insert on public.asset_documents
  for each row execute function public.asset_documents_guard();

-- Log dokumentationen i den immutable historik (SECURITY DEFINER: skriver uden
-- om asset_events' client-revoke). Ingen persondata i detail.
create or replace function public.log_asset_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.asset_events
    (asset_id, company_id, event_type, actor_user_id, detail)
  values
    (new.asset_id, new.company_id, 'documented', auth.uid(),
     jsonb_build_object(
       'document_id', new.id,
       'has_note', coalesce(new.note, '') <> '',
       'has_photo', new.storage_path is not null
     ));
  return new;
end;
$$;

create trigger asset_documents_log_event
  after insert on public.asset_documents
  for each row execute function public.log_asset_document();

-- ---------------------------------------------------------------------------
-- RLS: læses i egen virksomhed; oprettes af aktiv-roller. Ingen update/delete
-- fra klienter — dokumentationen er append-only bevismateriale.
-- ---------------------------------------------------------------------------
alter table public.asset_documents enable row level security;

create policy asset_documents_select on public.asset_documents
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy asset_documents_insert on public.asset_documents
  for insert to authenticated
  with check (
    (
      company_id = public.current_company_id()
      and public.has_any_role('manager', 'asset_manager', 'asset_handler', 'handheld_asset_handler')
    )
    or public.is_platform_admin()
  );

revoke update, delete on public.asset_documents from anon, authenticated;
grant select, insert on public.asset_documents to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: privat bucket til aktiv-fotos. Sti-konvention:
--   <company_id>/<asset_id>/<fil> — RLS binder mappen til brugerens tenant.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('asset-photos', 'asset-photos', false)
on conflict (id) do nothing;

create policy asset_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'asset-photos'
    and (
      (storage.foldername(name))[1] = public.current_company_id()::text
      or public.is_platform_admin()
    )
  );

create policy asset_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'asset-photos'
    and (
      (storage.foldername(name))[1] = public.current_company_id()::text
      or public.is_platform_admin()
    )
  );

-- Parcel-dokumentation: fotos + noter knyttet til en pakke, tilføjet over tid
-- (fx tilstands-/skadesbevis fra håndterminalen). Append-only evidens som
-- parcel_events — hver post har hvem/hvornår og logges i pakkens historik.
--
-- Filerne ligger i den private 'parcel-photos'-bucket under
-- <company_id>/<parcel_id>/<fil> (RLS binder første mappe til tenant'en).

create table public.parcel_documents (
  id uuid primary key default gen_random_uuid(),
  parcel_id uuid not null references public.parcels (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  storage_path text not null,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index parcel_documents_parcel_idx on public.parcel_documents (parcel_id, created_at);
create index parcel_documents_company_idx on public.parcel_documents (company_id, created_at);

-- FK-opslag omgår RLS, så tenant-tilhør valideres eksplicit (som parcels_guard).
create or replace function public.parcel_documents_guard()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.parcels p
    where p.id = new.parcel_id and p.company_id = new.company_id
  ) then
    raise exception 'Pakken tilhører ikke virksomheden';
  end if;
  return new;
end;
$$;

create trigger parcel_documents_guard
  before insert on public.parcel_documents
  for each row execute function public.parcel_documents_guard();

-- Log dokumentationen i den immutable pakkehistorik (SECURITY DEFINER: skriver
-- uden om parcel_events' client-revoke, som log_parcel_event).
create or replace function public.log_parcel_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.parcel_events
    (parcel_id, company_id, event_type, actor_user_id, detail)
  values
    (new.parcel_id, new.company_id, 'documented', auth.uid(),
     jsonb_build_object('document_id', new.id, 'has_note', coalesce(new.note, '') <> ''));
  return new;
end;
$$;

create trigger parcel_documents_log_event
  after insert on public.parcel_documents
  for each row execute function public.log_parcel_document();

-- ---------------------------------------------------------------------------
-- RLS: læses i egen virksomhed; oprettes af pakkehåndterere/managers. Ingen
-- update/delete fra klienter — dokumentationen er append-only bevismateriale.
-- ---------------------------------------------------------------------------
alter table public.parcel_documents enable row level security;

create policy parcel_documents_select on public.parcel_documents
  for select to authenticated
  using (company_id = public.current_company_id() or public.is_platform_admin());

create policy parcel_documents_insert on public.parcel_documents
  for insert to authenticated
  with check (
    (
      company_id = public.current_company_id()
      and (public.has_role('parcel_handler') or public.has_role('manager'))
    )
    or public.is_platform_admin()
  );

revoke update, delete on public.parcel_documents from anon, authenticated;
grant select, insert on public.parcel_documents to authenticated;

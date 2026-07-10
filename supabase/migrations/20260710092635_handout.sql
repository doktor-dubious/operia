-- Udlevering (spec §handover): hvem der afhentede, evt. proxy-note og
-- underskrift. Underskrifter er chain-of-custody-bevis — privat bucket med
-- samme tenant-mappe-mønster som tilstandsfotos.

alter table public.parcels
  add column delivered_to text,
  add column delivered_note text,
  add column delivered_signature_path text;

insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', false)
on conflict (id) do nothing;

create policy signatures_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'signatures'
    and (
      (storage.foldername(name))[1] = public.current_company_id()::text
      or public.is_platform_admin()
    )
  );

create policy signatures_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'signatures'
    and (
      (storage.foldername(name))[1] = public.current_company_id()::text
      or public.is_platform_admin()
    )
  );

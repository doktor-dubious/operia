-- Logs-fremviser (Operia → Logs) skal kunne facetteres som Supabase Studio:
-- ud over tidsrum også pr. KATEGORI (hvilket produkt/modul hændelsen hører til)
-- og pr. NIVEAU (success/warning/error). Begge udledes deterministisk af
-- 'action' (+ 'detail') via IMMUTABLE-hjælpere og lagres som GENEREREDE kolonner,
-- så de er den kanoniske definition, kan indekseres og aldrig kommer ud af sync
-- med handlingen. Klienten spejler den samme afbildning indtil server-side
-- filtrering tages i brug.

-- Kategori = produktet/modulet hændelsen hører til (udledt af action-præfikset).
create or replace function public.audit_category(p_action text)
returns text language sql immutable as $$
  select case split_part(coalesce(p_action, ''), '.', 1)
    when 'parcel'         then 'parcels'
    when 'parcel_flow'    then 'parcels'
    when 'employee'       then 'directory'
    when 'department'     then 'directory'
    when 'location'       then 'config'
    when 'handling_class' then 'config'
    when 'carrier'        then 'config'
    when 'shipping'       then 'shipping'
    when 'agreement'      then 'shipping'
    when 'asset'          then 'assets'
    when 'asset_category' then 'assets'
    when 'asset_location' then 'assets'
    when 'assets'         then 'assets'
    when 'inventory_item' then 'inventory'
    when 'locker'         then 'lockers'
    when 'user'           then 'access'
    when 'product'        then 'entitlements'
    when 'feature'        then 'entitlements'
    when 'template'       then 'branding'
    when 'language'       then 'branding'
    when 'currency'       then 'branding'
    when 'import'         then 'imports'
    when 'import_config'  then 'imports'
    else 'other'
  end
$$;

-- Niveau = success / warning / error (samme tre som Supabase Studio).
--   error   : en handling der mislykkedes teknisk.
--   warning : destruktive/negative men tilsigtede handlinger (sletning,
--             deaktivering, anonymisering, afvist import, afvist/returneret pakke).
--   success : alt andet (oprettet, ændret, udleveret, anvendt import, …).
create or replace function public.audit_level(p_action text, p_detail jsonb)
returns text language sql immutable as $$
  select case
    when p_action = 'import.failed' then 'error'
    when p_action = 'import.rejected'
      or p_action like '%.deleted'
      or p_action like '%.deactivated'
      or p_action like '%.anonymized'
      or p_action like '%.removed'
      or p_action like '%.revoked'
      or p_action like '%.disabled'
      or (p_action = 'parcel.status_changed'
          and coalesce(p_detail->>'to_status', '') in ('rejected', 'returned'))
      then 'warning'
    else 'success'
  end
$$;

alter table public.audit_log
  add column category text generated always as (public.audit_category(action)) stored,
  add column level    text generated always as (public.audit_level(action, detail)) stored;

create index audit_log_category_idx on public.audit_log (category);
create index audit_log_level_idx on public.audit_log (level);

-- ---------------------------------------------------------------------------
-- Aktør-opslag til Logs-fremviseren. En aktør (audit_log.actor_user_id) kan
-- være en virksomhedsbruger (findes i public.app_users, som platform-admins
-- allerede kan læse på tværs af tenants) ELLER en DCA-platform-admin, som IKKE
-- har noget klient-læsbart navn i public. Denne SECURITY DEFINER-funktion
-- eksponerer (user_id → e-mail) fra auth.users, men returnerer KUN rækker for
-- platform-admins (gaten ligger i WHERE, så ikke-admins får nul rækker).
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_emails()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text
  from auth.users u
  where public.is_platform_admin()
$$;

revoke execute on function public.admin_user_emails() from public, anon;
grant execute on function public.admin_user_emails() to authenticated;

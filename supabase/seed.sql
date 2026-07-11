-- LOKAL udviklings-seed. Køres KUN af `supabase db reset` lokalt — aldrig af
-- `db push`, så intet her rammer det rigtige projekt.
-- Demo-login: demo@operia.local / operia123 (manager + parcel_handler)

-- Demo-virksomhed
insert into public.companies (id, name, registration_no) values
  ('11111111-1111-1111-1111-111111111111', 'DCA Demo A/S', '12345678');

-- Auth-bruger (lokal GoTrue)
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current
) values (
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'demo@operia.local',
  crypt('operia123', gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '22222222-2222-2222-2222-222222222222',
  '22222222-2222-2222-2222-222222222222',
  'email',
  '{"sub":"22222222-2222-2222-2222-222222222222","email":"demo@operia.local"}',
  now(), now(), now()
);

insert into public.app_users (user_id, company_id, full_name, email) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
   'Demo Bruger', 'demo@operia.local');

insert into public.user_roles (user_id, role) values
  ('22222222-2222-2222-2222-222222222222', 'manager'),
  ('22222222-2222-2222-2222-222222222222', 'parcel_handler');

-- Entitlements: kerneproduktet + et par features
insert into public.company_products (company_id, product_key) values
  ('11111111-1111-1111-1111-111111111111', 'parcels');
insert into public.company_features (company_id, feature_key) values
  ('11111111-1111-1111-1111-111111111111', 'reminders'),
  ('11111111-1111-1111-1111-111111111111', 'photo'),
  ('11111111-1111-1111-1111-111111111111', 'signature');

-- Afdelinger og medarbejdere
insert into public.departments (id, company_id, name) values
  ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111', 'Økonomi'),
  ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111111', 'IT'),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Reception');

insert into public.employees (id, company_id, department_id, initials, full_name, email) values
  ('44444444-4444-4444-4444-444444444441', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333331', 'MSØ', 'Mette Sørensen', 'mso@dcademo.dk'),
  ('44444444-4444-4444-4444-444444444442', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333332', 'JÅB', 'Jørgen Åberg', 'jab@dcademo.dk'),
  ('44444444-4444-4444-4444-444444444443', '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333', 'LKH', 'Lise Kjær Holm', 'lkh@dcademo.dk');

-- Placeringer
insert into public.storage_locations (id, company_id, name, barcode) values
  ('55555555-5555-5555-5555-555555555551', '11111111-1111-1111-1111-111111111111', 'Reol A1', 'LOC-A1'),
  ('55555555-5555-5555-5555-555555555552', '11111111-1111-1111-1111-111111111111', 'Reol A2', 'LOC-A2'),
  ('55555555-5555-5555-5555-555555555553', '11111111-1111-1111-1111-111111111111', 'Kælder', null);

-- Pakker i forskellige tilstande (guard-triggeren validerer/retter status)
insert into public.parcels (company_id, barcode, receiver_employee_id, department_id, storage_location_id, status, sender) values
  ('11111111-1111-1111-1111-111111111111', 'PKG-0001',
   '44444444-4444-4444-4444-444444444441', '33333333-3333-3333-3333-333333333331',
   '55555555-5555-5555-5555-555555555551', 'in_storage', 'GLS'),
  ('11111111-1111-1111-1111-111111111111', 'PKG-0002',
   '44444444-4444-4444-4444-444444444442', '33333333-3333-3333-3333-333333333332',
   null, 'registered', 'PostNord'),
  ('11111111-1111-1111-1111-111111111111', 'PKG-0003',
   null, null, '55555555-5555-5555-5555-555555555553', 'unassigned', 'DHL'),
  ('11111111-1111-1111-1111-111111111111', 'PKG-0004',
   '44444444-4444-4444-4444-444444444443', '33333333-3333-3333-3333-333333333333',
   null, 'registered', 'UPS');

-- En pakke gennem hele flowet til 'delivered' (via gyldige overgange)
update public.parcels set status = 'in_transit' where barcode = 'PKG-0004';
update public.parcels set status = 'delivered' where barcode = 'PKG-0004';

-- Fragtfirmaer + håndteringsklasser til demo-virksomheden
insert into public.carriers (company_id, name) values
  ('11111111-1111-1111-1111-111111111111', 'GLS'),
  ('11111111-1111-1111-1111-111111111111', 'PostNord'),
  ('11111111-1111-1111-1111-111111111111', 'DHL'),
  ('11111111-1111-1111-1111-111111111111', 'UPS');

insert into public.handling_classes (company_id, name, allow_proxy_collection, allow_leave_at_location, description) values
  ('11111111-1111-1111-1111-111111111111', 'Standard', true, true, 'Almindelige pakker'),
  ('11111111-1111-1111-1111-111111111111', 'Personlig overdragelse', false, false, 'Skal udleveres direkte til modtageren'),
  ('11111111-1111-1111-1111-111111111111', 'Køl', false, false, 'Temperaturfølsom — hurtig udlevering');

-- Testbruger UDEN manager-rolle (handler@operia.local / operia123) — til at
-- teste at RLS-afviste skrivninger vises som manglende rettigheder.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
values ('99999999-9999-9999-9999-999999999999','00000000-0000-0000-0000-000000000000','authenticated','authenticated','handler@operia.local', crypt('operia123', gen_salt('bf')), now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','','');
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(),'99999999-9999-9999-9999-999999999999','99999999-9999-9999-9999-999999999999','email','{"sub":"99999999-9999-9999-9999-999999999999","email":"handler@operia.local"}',now(),now(),now());
insert into public.app_users (user_id, company_id, full_name, email)
values ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','Test Handler','handler@operia.local');
insert into public.user_roles (user_id, role) values ('99999999-9999-9999-9999-999999999999','parcel_handler');

-- 10 testkunder (til virksomhedsskifteren)
with new_companies as (
  insert into public.companies (name, registration_no)
  values
    ('Nordvind Logistik ApS','20110001'),('Baltic Fragt A/S','20110002'),
    ('Grøndal & Søn ApS','20110003'),('Havnekontoret A/S','20110004'),
    ('Jysk Pakkecenter ApS','20110005'),('Møllegården Ejendomme A/S','20110006'),
    ('Fjordbyg Entreprise ApS','20110007'),('Skovgaard Medico A/S','20110008'),
    ('Citypost Danmark ApS','20110009'),('Østerbro Kontorhotel A/S','20110010')
  returning id
)
insert into public.company_products (company_id, product_key)
select id, 'parcels' from new_companies;

-- Stamdata til testkunderne (afdelinger, placeringer, håndtering, fragt)
with cos as (select id from public.companies where registration_no like '201100%')
insert into public.departments (company_id, name)
select cos.id, d.name from cos cross join (values ('Administration'),('Lager'),('Salg')) d(name);

with cos as (select id from public.companies where registration_no like '201100%')
insert into public.storage_locations (company_id, name, barcode)
select cos.id, l.name, l.barcode from cos cross join (values
  ('Reception', 'REC-01'), ('Reol B1', 'LOC-B1'), ('Postrum', null)) l(name, barcode);

with cos as (select id from public.companies where registration_no like '201100%')
insert into public.handling_classes (company_id, name, allow_proxy_collection, allow_leave_at_location, description)
select cos.id, h.name, h.proxy, h.leave, h.descr from cos cross join (values
  ('Standard', true, true, 'Almindelige pakker'),
  ('Personlig overdragelse', false, false, 'Udleveres kun til modtageren')) h(name, proxy, leave, descr);

with cos as (select id from public.companies where registration_no like '201100%')
insert into public.carriers (company_id, name)
select cos.id, c.name from cos cross join (values ('GLS'),('PostNord'),('Bring')) c(name);

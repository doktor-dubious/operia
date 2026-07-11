-- Skabeloner pr. sprog: hver skabelon findes i flere sprog. Udvid nøglen fra
-- (key) til (key, lang). Eksisterende rækker bliver dansk ('da').

alter table public.platform_templates
  add column lang text not null default 'da';

alter table public.platform_templates drop constraint platform_templates_pkey;
alter table public.platform_templates add primary key (key, lang);

-- Engelsk udgave af invitations-skabelonen.
insert into public.platform_templates (key, lang, name, title, body) values
  (
    'customer_invite',
    'en',
    'New Customer Invite',
    'You have been invited to Operia',
    '<p>You have been invited to create an account in Operia.</p>
<p>Click the button below to accept the invitation and choose your password.</p>
<p><a href="{{link}}" style="display:inline-block;background:#131413;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:500">Accept invitation</a></p>
<p style="color:#8a908a;font-size:12px">If the button does not work, copy this link into your browser:<br>{{link}}</p>'
  )
on conflict (key, lang) do nothing;

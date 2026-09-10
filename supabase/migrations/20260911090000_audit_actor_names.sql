-- Aktørnavne i revisionssporene (EVU-krav D-02: "hvem har foretaget ændringen").
--
-- Hændelserne gemmer auth-bruger-id'et. Web'en har hidtil slået det op i
-- app_users for den aktive virksomhed — og det virker for kundens egne brugere,
-- men IKKE for DCA's platform-administratorer: de har ingen app_users-række i
-- nogen virksomhed, så hver eneste linje de har rørt stod som "Ukendt bruger".
-- Det er den værste af alle udgaver af et revisionsspor: sporet ved godt hvem
-- det var, og siger det bare ikke.
--
-- Denne funktion er opslaget, der dækker begge slags aktører, og den er
-- SECURITY DEFINER, fordi auth.users og platform_admins ikke er læsbare for en
-- almindelig bruger.
--
-- Hvad kunden får at se om en DCA-medarbejder: at det VAR DCA (platform = true)
-- og ikke hvem af dem. Databehandleren handler på kundens vegne som
-- organisation, og en support-medarbejders arbejds-e-mail hører ikke hjemme i
-- kundens skærmbillede. DCA's egne folk ser e-mailen — de kan i forvejen se
-- alle brugere på operia/logs — så et spor kan forfølges hele vejen internt.
-- Se docs/evu-booking-kravstatus.md (D-02).

create or replace function public.audit_actor_names(p_company_id uuid)
returns table (user_id uuid, display_name text, platform boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  with allowed as (
    select p_company_id as cid
    where p_company_id = public.current_company_id() or public.is_platform_admin()
  ),
  -- Virksomhedens egne brugere OG de aktører, der faktisk optræder i
  -- bookinghistorikken. Det andet led er grunden til, at aktørfilteret på
  -- historiksiden kan tilbyde en platform-admin at filtrere på.
  ids as (
    select a.user_id from public.app_users a join allowed on a.company_id = allowed.cid
    union
    select e.actor_user_id
    from public.booking_events e join allowed on e.company_id = allowed.cid
    where e.actor_user_id is not null
  )
  select
    i.user_id,
    case
      when au.user_id is not null
        then coalesce(nullif(btrim(au.full_name), ''), nullif(btrim(au.email), ''))
      when public.is_platform_admin()
        then (select u.email::text from auth.users u where u.id = i.user_id)
      else null
    end as display_name,
    (pa.user_id is not null) as platform
  from ids i
  left join public.app_users au
    on au.user_id = i.user_id and au.company_id = p_company_id
  left join public.platform_admins pa on pa.user_id = i.user_id
$fn$;

revoke all on function public.audit_actor_names(uuid) from public;
grant execute on function public.audit_actor_names(uuid) to authenticated;

comment on function public.audit_actor_names(uuid) is
  'Aktør-id → visningsnavn for revisionssporene. Kundens egne brugere ved navn; DCA-platform-admins kun som platform=true over for kunden.';

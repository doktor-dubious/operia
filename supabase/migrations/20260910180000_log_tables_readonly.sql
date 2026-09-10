-- Loggene gøres skrivebeskyttede for KLIENTROLLERNE (EVU-krav D-03).
--
-- Beskyttelsen har i praksis holdt hele tiden: alle logtabellerne har RLS slået
-- til og INGEN skrivepolitik, så hverken browseren eller anon-nøglen kan røre
-- dem gennem PostgREST. Hændelsestabellerne har oven i købet en
-- rækketrigger (block_mutation), der afviser UPDATE og DELETE — også for ejeren.
--
-- Men rettighederne selv blev aldrig trimmet. Supabase giver som standard
-- `grant all` på nye tabeller i public til anon og authenticated, og de
-- oprindelige migrationer tilbagekaldte kun UPDATE og DELETE. Tilbage stod:
--
--   • TRUNCATE på dem alle. Det er den alvorlige af slagsen: RLS gælder IKKE
--     for TRUNCATE, og block_mutation er en RÆKKEtrigger, som derfor aldrig
--     fyrer. På papiret kunne rollen `authenticated` altså tømme revisionsloggen.
--     Det kan ikke nås gennem PostgREST (der findes ingen TRUNCATE-metode), så
--     det kræver en direkte Postgres-forbindelse som den rolle — noget vi ikke
--     udleverer. Men D-03's acceptkriterie siger "skrivebeskyttet for alle
--     roller", og en rettighed man ikke kan nå i dag, er stadig en rettighed.
--   • INSERT på hændelsestabellerne. RLS afviser det nu, men rettigheden ville
--     blive levende i samme øjeblik nogen tilføjede en bredere politik til et
--     helt andet formål.
--   • Fulde DML-rettigheder på de tre beskedlogge, som hverken har
--     skrivepolitik eller immutabilitetstrigger.
--
-- Ingen af rettighederne bruges: alt, der skriver i loggene, er enten
-- SECURITY DEFINER (record_audit, triggerne, flow-RPC'erne) eller kører som
-- service_role (dispatcherne). service_role røres derfor ikke.
--
-- BESKEDLOGGENE FÅR BEVIDST IKKE en immutabilitetstrigger: de opdateres
-- lovligt EFTER indsættelsen, når udbyderen melder et bounce tilbage
-- (_shared/mail-events.ts sætter bounced_at og bounce_reason). En trigger som
-- block_mutation ville afvise netop den opdatering og dermed tabe
-- leveringsstatus. Deres beskyttelse er RLS uden skrivepolitik.

revoke insert, update, delete, truncate, trigger on
  public.audit_log,
  public.booking_events,
  public.parcel_events,
  public.asset_events,
  public.booking_notifications,
  public.parcel_notifications,
  public.asset_loan_notifications
from anon, authenticated;

-- Læseadgangen er uændret og styres fortsat af RLS-politikkerne.
grant select on
  public.audit_log,
  public.booking_events,
  public.parcel_events,
  public.asset_events,
  public.booking_notifications,
  public.parcel_notifications,
  public.asset_loan_notifications
to authenticated;

comment on table public.booking_events is
  'Append-only hændelseslog for bookinger (EVU D-01/D-02). Skrives kun af rækketriggeren audit_bookings_row og flow-RPC''erne; UPDATE/DELETE er frataget alle roller og blokeres desuden af block_mutation.';

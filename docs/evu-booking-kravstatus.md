# EVU booking og fakturering — kravstatus mod Operia

Vurdering af `docs/Booking- og faktureringsløsning til EVU.txt` (Daniel Trampedach, udkast) mod
Operia-kodebasen pr. **2026-09-05** (commit `32c11e9`). Status er procent af *acceptkriteriet*,
ikke af arbejdet: 100 % = acceptkriteriet kan demonstreres i dag.

**Bygget siden førstevurderingen** (opdaterede rækker er markeret med datoen):
- **2026-09-08 — statusmodellen (A-02)**: booket → i brug → afsluttet udledes af tiden og vises
  som ét trin i liste, kalender og bookingdetaljen; *faktureret* er en lagret kendsgerning
  (`bookings.invoiced_at`) med egen RPC, egen hændelse og lås mod rettelse/annullering.
  Migration `20260908090000_booking_invoiced_status.sql`, fixtures
  `supabase/tests/booking_invoiced.sql`.
- **2026-09-08 — booking-notifikationer (A-04)**: fem beskeder (oprettet, ændret, annulleret,
  påmindelse før start, sendt til fakturering) på alle fire kanaler, med modtagerne medarbejder,
  rekvirent (`booked_by`), fast kopiadresse og fakturerings-postkasse. Migration
  `20260908160000_booking_notifications.sql`, edge-funktion
  `dispatch-booking-notifications` (pg_cron hvert 5. minut), 40 skabeloner,
  notifikationstypen "Booking-flow" på begge notifikationssider.
- **2026-09-08 — kursister (A-05)**: antal og niveau på bookingen, med niveauerne som en
  vedligeholdt liste pr. kunde (Konfigurér → Booking) frem for fri tekst, fordi taksten i C-07
  skal kunne slås op på dem. Migration `20260908190000_booking_participants.sql`, fixtures
  `supabase/tests/booking_participants.sql`.
- **2026-09-09 — afbestilling med årsag (A-07)**: `cancel_booking` kræver nu en årsag og er
  flyttet fra `can_operate_bookings` til en egen grænse `can_cancel_bookings`
  (manager/booking_manager — en booking_handler kan ikke længere afbestille). Knappen er flyttet
  fra detaljepopup'en ind i redigeringsdialogen og åbner en bekræftelsesdialog med årsagsfelt.
  Migration `20260909090000_booking_cancellation_reason.sql`, fixtures
  `supabase/tests/booking_cancellation.sql`.
- **2026-09-09 — tilkøbsydelser (A-06)**: ydelseskatalog pr. kunde på den nye side
  Booking → Tilkøbsydelser, og ydelseslinjer med antal og prissnapshot på den enkelte booking.
  Bookinglisten har samtidig fået et detaljepanel med faner (stamdata, tidsrum, formål,
  tilkøbsydelser, handlinger) i stedet for popup'en. Migration
  `20260909120000_booking_services.sql`, fixtures `supabase/tests/booking_services.sql`.
- **2026-09-10 — CSV-eksport (B-01)**: eksportdialog med rækkeform (bookinger / afregningslinjer),
  formatprofil, separator/decimaltegn/datoformat, kolonnevalg og filnavn. Fem indgange:
  bookinglistens værktøjslinje (følger filtre og markering), handlingsfanen, kalenderens popup,
  ressourcens info-dialog og kalenderens tidsrum. Hver eksport logges (`booking.exported`).
  Migration `20260910120000` + `20260910130000`, fixtures `supabase/tests/booking_export.sql`.
- **2026-09-10 — ændringsloggen på databaseniveau (D-01/D-02)**: en rækketrigger på `bookings`
  er nu eneste skribent; RPC'erne skriver ikke længere selv. Enhver vej ind i tabellen logges,
  før/efter dækker alle strukturelle felter, og fritekst holdes ude med vilje. Migration
  `20260910160000_booking_audit_trigger.sql`, fixtures `supabase/tests/booking_audit_trigger.sql`.
- **2026-09-10 — bookinghistorik (D-05)**: siden Booking → Historik med filtrering på periode,
  bruger og fritekst (ressource, formål, medarbejder, booking-id), plus en historik-fane på den
  enkelte booking. Ændringerne vises læsbart med navne i stedet for id'er, og
  tilkøbsydelsernes beløbskonsekvens står i en egen kolonne (D-04's beløbshalvdel).
  `lib/booking-history.ts` + `components/booking-history-view.tsx`.
- **2026-09-10 — eksport af historikken (D-06)**: CSV, PDF og Word fra historiksiden, bygget på
  den ReportDoc-model og de renderere pakkerapporterne allerede bruger. Udskriften bærer sine egne
  filtre, et nøgletalsafsnit (tillæg/fradrag/netto) og hele tabellen med læsbare før/efter.
  Hver eksport logges. `lib/booking-history-report.ts` + `components/booking-history-export-dialog.tsx`,
  migration `20260910230000`.
- **2026-09-12 — fakturakladden (C-01, C-06, C-07, C-08, C-10)**: `invoice_drafts` +
  `invoice_draft_lines` som en **systemuafhængig** model — kladden er Operias egen, og et
  regnskabssystem er et felt plus en adapter. Dannes fra bookinglistens udvalg uden manuel
  indtastning: lokale (takst × dagtælling), kursistniveau og hvert tilkøb for sig, alle med
  prissnapshot. Bookinger, der ikke kan prissættes, kommer TILBAGE i svaret med årsag frem for at
  forsvinde (C-04). Godkendelse, overførsel med fakturanummer (som markerer bookingerne
  faktureret og låser dem) og annullering, alt i sporet. Dagtællingen er en virksomhedsindstilling
  (`companies.booking_day_basis`: kalenderdage eller hverdage), så kundens svar på spørgsmål 4
  bliver et valg og ikke en migration. Migration `20260912120000_invoice_drafts.sql`, fixtures
  `supabase/tests/invoice_drafts.sql`.
- **2026-09-13 — første rigtige overførsel til e-conomic**: FK-00003 → e-conomic-kladde nr. 1 på
  prøveaftale 2459977. Fejl fundet og rettet undervejs (undefined vs. null til PostgREST), plus
  genbrug af eksisterende e-conomic-kladde via referencefeltet. Tilbage: bogfør + hent fakturanr.
- **2026-09-13 — e-conomic-adapteren (C-02, løfter C-09)**: e-conomics svar ("appen kan installeres
  nu") fjernede blokeringen. `economic-transfer` opretter kladden i e-conomic fra kundens egen
  fakturaskabelon, mapper linjer til produkter valgt fra e-conomics lister, lægger vores kladdenr.
  i referencefeltet og henter fakturanummeret tilbage efter bogføring (eller bogfører straks).
  Verificeret mod demo-aftalen frem til POST. Migration `20260913210000`, edge-funktion skal deployes.
- **2026-09-13 — bookingimport (B-03), planlagt fileksport (B-02) og driftsaftale-udkast (F-04/05/07)**:
  import med kolonnemapning og tørkørsel i basen (idempotent på `external_ref`, tid i virksomhedens
  tidszone, alt gennem RPC'erne); planlagt CSV serverside til privat bucket + signeret link, samme
  kolonner som den manuelle eksport; `docs/drift-og-support.md` med hosting, backup/RPO/RTO og
  support som udkast med DCA's valg markeret. Migrationer `20260913150000` + `20260913180000`,
  edge-funktion `booking-export-run` (skal deployes).
- **2026-09-13 — de fem "kan startes nu" (E-02, F-01/C-08, C-09, C-04, D-04)**: afstemningsrapport
  (Booking → Afstemning, periode = overførselsdato, kreditnotaer negative, CSV/PDF); økonomirollen
  `finance_manager` (godkend/overfør/kreditér — booking_manager afvises server-side); kreditnota som
  kladde af arten `credit`, hel eller pr. linje, fuld kreditering løfter låsen; tal på forsidens
  Booking-flise; beløb før/efter skrevet af triggeren på bookinghændelserne. Migrationer
  `20260913120000` + `20260913120100`, fixtures `supabase/tests/finance_credit_amounts.sql`.
- **2026-09-13 — momskoder dér, hvor momsen afgøres (A-06, lukker C-05)**: momskoden bor nu på
  ressourcekategorien, kursistniveauet og tilkøbsydelsen — ikke på taksten, hvor den lå: et
  lokales momsbehandling ændrer sig ikke, fordi prisen gør. Kladdens tre linjetyper arver hver
  sin kode; ændringer logges. Migration `20260913090000_booking_vat_codes.sql`, fixtures
  `supabase/tests/booking_vat_codes.sql`.
- **2026-09-12 — dagtællingen som indstilling i brugerfladen**: `companies.booking_day_basis`
  fandtes siden C-01, men kunne kun sættes med SQL. Nu en vælger på Konfigurér → Booking
  (kalenderdage/hverdage). Spørgsmål 4 til kunden er dermed lukket.
- **2026-09-12 — bookingrapporten (E-01, E-03, E-04; lukker A-01/A-03, løfter C-03/C-04/B-01/D-06)**:
  Booking → Rapport med kombinerbare filtre i URL'en (periode som overlap, ressource, afdeling via
  medarbejderen, bookingstatus, faktureringsstatus i tre tilstande), nøgletal, forvalget "Afsluttet,
  ikke faktureret", detaljepanel fra rækken, "Dan fakturakladde" på udvalget, CSV og PDF med
  filtrene i sidehovedet. Debitor som filter venter på, at begrebet findes (spørgsmål 3).
  `lib/booking-report.ts` + `routes/_app/booking.report.tsx`, migration `20260912200000`.
- **2026-09-12 — rettelser slår igennem på fakturagrundlaget (A-03, afslutter A-02/A-05/A-07)**:
  en booking på en åben kladde kunne rettes, uden at kladden mærkede det — godkendte beløb, der
  ikke længere gjaldt. Nu stempler triggere kladden forældet ved enhver ændring af det, den
  regner på, trækker godkendelsen tilbage og spærrer overførsel, indtil "Dan igen" har afløst
  den (gammel annulleret, ny med samme debitor og note, afbestilte udeladt). Migration
  `20260912180000_invoice_draft_stale.sql`, fixtures `supabase/tests/invoice_draft_stale.sql`.
- **2026-09-11 — Dalux FM-integration, første skive (B-05..B-10)**: opsætning på begge
  integrationssider, nøgle serverside med udløb, produktion/stage, forbindelsestest, objektvalg,
  tidsplan (manuel/interval/dag/uge/måned) med ét cron-job, udboks med fejlliste og gensend, og
  **lokaler → ressourcer** med adoption af eksisterende ressourcer. Bygget mod den offentlige
  API-spec (SwaggerHub v2.5.0) og prøvet mod en attrap af den. Dalux FM har intet booking-objekt,
  og et rum har intet navnefelt — begge dele er gjort til opsætning frem for antagelse. Migration
  `20260912150000_dalux_integration.sql`, fixtures `supabase/tests/dalux_integration.sql`,
  edge-funktion `dalux-sync` (skal deployes).
- **2026-09-11 — prisliste med tidsafgrænsede takster (C-05)**: `booking_tariffs` pr. ressource,
  ydelse og kursistniveau. Enheden (dag/time/kursist/kursist pr. dag/fast) er en kolonne og ikke
  en antagelse, så de tre ubesvarede kundespørgsmål om beregningsgrundlaget kan besvares med en
  indtastning. Overlap mellem to takster med samme enhed afvises af basen, så prisopslaget har ét
  svar; en pris rettes ikke, den afløses. Dermed er **C-01 ikke længere blokeret** — det, der
  manglede, var operanden, ikke regnestykket. Migration `20260911180000_booking_tariffs.sql`.
- **2026-09-11 — filerne med i kundeudtrækket (F-08 færdig)**: fotos, underskrifter, aktivbilag
  og designbilleder hentes fra Storage ned i pakken. Stierne høstes fra de rækker, der alligevel
  eksporteres, så pakken stemmer med CSV'erne; `filer.csv` giver hver fil en status, så en
  manglende fil er en oplysning frem for en tavshed. Ingen ny adgangsvej: Storage-politikkerne er
  i forvejen mappe-afgrænsede pr. virksomhed. Migration `20260911150000_company_export_files.sql`.
- **2026-09-11 — samlet kundeudtræk (F-08)**: ZIP med én CSV pr. tabel, mappelagt efter produkt,
  plus manifest og læsevejledning. Tre serverfunktioner: hvidlisten over hvad der må udleveres,
  manifestet med rækketal og kolonner (så en tom tabel stadig får en fil med overskrifter, og
  kolonnerne står i tabellens egen orden frem for jsonb's tilfældige), og rækkerne én nøglesat
  side ad gangen. Hemmelighedstabellerne står ikke på listen; de to nøglefelter i almindelige
  tabeller maskeres. Knappen står FØR deaktivér/slet i handlingsfanen — ved ophør er rækkefølgen
  udtræk, så nedlukning. Migration `20260911120000_company_full_export.sql`, fixtures
  `supabase/tests/company_full_export.sql`.
- **2026-09-10 — aktørnavne i sporet (D-02)**: navneopslaget slog aktør-id'et op i `app_users`
  for den aktive virksomhed. DCA's platform-administratorer har ingen række dér, så hver linje
  de havde rørt stod som "Ukendt bruger" — den værste udgave af et revisionsspor: det ved godt
  hvem det var og siger det ikke. Ny `audit_actor_names(company_id)` dækker begge slags aktører.
  Kunden ser DCA som organisationen ("DCA Logic (support)") og ikke som personer — databehandleren
  handler på kundens vegne, og en support-medarbejders arbejds-e-mail hører ikke hjemme i kundens
  skærmbillede; DCA's egne folk ser e-mailen, så et spor kan forfølges internt. Aktørfilteret
  rummer nu også platformen, så en manager kan spørge "hvad har leverandøren rørt".
  Migration `20260911090000_audit_actor_names.sql`.
  *Samme mangel findes stadig på aktivhistorikken (`components/asset-history.tsx`) — uden for
  EVU's kravsæt, men den skal have samme opslag.*
- **2026-09-10 — læseadgang til loggene strammet (D-03/F-01)**: politikkerne krævede kun
  tenant-grænsen, så enhver bruger i virksomheden kunne hente ændringsloggen gennem API'et,
  selv om siden var rollestyret. Nu kræver `booking_events` manager/booking_manager og
  `audit_log` en ansvarsrolle. Migration `20260910220000_log_read_roles.sql`, fixtures
  `supabase/tests/log_read_roles.sql`.
- **2026-09-10 — loggene skrivebeskyttet for klientrollerne (D-03)**: overskydende rettigheder
  fra Supabases standard-`grant all` tilbagekaldt på alle syv logtabeller — vigtigst **TRUNCATE**,
  som hverken RLS eller rækketriggere fanger. Migration `20260910180000_log_tables_readonly.sql`,
  fixtures `supabase/tests/log_readonly.sql`.

**Estimater** er arbejdsdage for én udvikler i denne kodebase (migration + RPC'er + web-UI + i18n
da/en + dokumentation + review). Afklaringsrunder med kunden, ekstern jura og leverandøromkostninger
er ikke medregnet. "Afklares" = kan ikke prissættes endeligt, før kunden har svaret.

## Samlet billede

| Afsnit | Krav | Gennemsnitlig status | Estimat til 100 % |
|---|---|---|---|
| A. Booking og ressourcestyring | 7 | 98 % | ≈ 0 d (A-04's debitor følger spørgsmål 3) |
| B. Integration til Dalux/FM | 10 | 72 % | ≈ 11 d (≈ 9 d afventer kundens objektvalg + stage-nøgle + Dalux-ark) |
| C. Dataflow booking → afregning | 10 | 96 % | ≈ 1 d (bogfør + hent fakturanr. mod den rigtige aftale; debitor-rest følger spørgsmål 3) |
| D. Sporbarhed og ændringslog | 7 | 91 % | ≈ 1 d |
| E. Rapportering og afstemning | 4 | 92 % | ≈ 0,5 d (debitorfilter/-kolonne, når begrebet findes) |
| F. Drift, sikkerhed og support | 8 | 68 % | ≈ 7 d (heraf ≈ 3 d DCA's beslutninger/jurist, ikke udvikling; 3,5 d SSO [Kan]) |
| **I alt** | **46** | **85 %** | **≈ 24 d** — ≈ 6 d kode kan startes nu (SSO [Kan], SFTP-push, tælleflise-mail), ≈ 7 d er DCA's beslutninger/dokumenter, ≈ 11 d afventer kunden (debitor, Dalux-objekt, momskoder) |

Fordeling: 34 opfyldt (≥ 90 %), 10 delvist (25–89 %), 2 påbegyndt (5–24 %), 0 mangler (0–4 %). Ved førstevurderingen 5. september: 3 / 13 / 13 / 17.

Det bærende fund fra 5. september var, at **bookingkernen var solid, men alt der handlede om penge manglede**. Det er indhentet (status pr. 13. september): bookingen bærer status, kursister, afbestillingsårsag og tilkøb; der er prisliste, fakturakladde med godkendelse og forældelse ved rettelser, rapport med filtre og eksport, historik, samlet kundeudtræk og første skive af Dalux-integrationen. Tilbage står det, der kræver **svar fra kunden frem for kode**: **debitor** (hvem faktureres — afgør kunderegister eller afdeling), **regnskabssystem** (C-02, og dermed E-02 og C-09), **Dalux-objekt + stage-nøgle** (udgående B-05) og **momskodernes værdier**. Alt fire er stillet som konkrete spørgsmål nedenfor. Kravspecifikationens afsnit 5.1 ("Nuværende flow") beskriver stadig en løsning, der ikke er bygget, og bør rettes, inden dokumentet sendes til kunden.

## Kan startes nu

Det, der hverken venter på e-conomic-login, Dalux-objekt/stage-nøgle, debitorsvar eller
momskoder. Rækkefølgen er min anbefaling: først det, der lukker flest krav pr. dag.

| # | Arbejde | Krav | Dage | Hvorfor nu |
|---|---|---|---|---|
| 1 | ~~**Afstemningsrapport**~~ *(bygget 2026-09-13)* — booking → kladde → fakturanr. pr. række, periode, CSV/PDF | E-02, D-06 | 1,5 | Kæden findes via manuel overførsel; adapteren ændrer kun nummerets kilde |
| 2 | ~~**Økonomirolle**~~ *(bygget 2026-09-13)* — `finance_manager`: godkend/overfør kladder, se rapporter; booking_manager mister overførsel | F-01, C-08 | 1,5 | "En ansvarlig frigiver" er i dag "en bookingansvarlig frigiver" |
| 3 | ~~**Kreditnota (Operia-siden)**~~ *(bygget 2026-09-13)* — negativ kladde med reference, hel/differens, godkendelse | C-09 | 3 | Kun overførslen venter på C-02 |
| 4 | ~~**Tælleflise + påmindelse**~~ *(bygget 2026-09-13)* — "afsluttet, ikke faktureret" på forsiden og som ugentlig mail | C-04 | 0,5 | Rapporten kræver, at nogen åbner den |
| 5 | ~~**Beløbskolonne i historikken**~~ *(bygget 2026-09-13)* udvidet med lokale-/kursisttakster | D-04 | 0,5 | Taksterne findes nu |
| 6 | ~~**Bookingimport fra CSV**~~ *(bygget 2026-09-13)* — upload → tørkørsel (overlap, ukendt ressource/medarbejder) → anvend, med kolonnemapning og eksternt id | B-03 | 5,5 | Mapnings-UI'et er svaret på det ukendte Dalux-ark; genbruger importmotoren |
| 7 | ~~**Planlagt fileksport**~~ *(bygget 2026-09-13)* — serverside CSV efter rapportens filtre, tidsplan pr. kunde, levering via SFTP-push/e-mail | B-02 | 5 | Uafhængig af Dalux-API'et; genbruger Dalux-synkens tidsplan-mønster |
| 8 | **Backup/RPO/RTO** *(aftaletekst udkastet; opsætning + test venter på DCA's planvalg)* — PITR-opsætning, gendannelsestest, tal i driftsaftalen | F-05 | 1,5 | DCA's beslutning (planopgradering), ikke kundens |
| 9 | ~~**Hostingdokumentation**~~ *(docs/drift-og-support.md §1)* (EU/EØS, underdatabehandlere) | F-04 | 0,5 | Skrivearbejde |
| 10 | **DPA-bilag færdiggjort** + ekstern jurist | F-03 | 1,5 | DCA-arbejde; juristen er ekstern tid |
| 11 | ~~**Supportaftale**~~ *(udkast, tal mangler)* — vindue, kanaler, reaktionstider | F-07 | 0,75 | Aftaletekst, ikke udvikling |
| 12 | **SSO via Entra ID** [Kan] | F-06 | 3,5 | Kan prøves mod DCA's dev-tenant; EVU's tenant først ved go-live |
| | **I alt** | | **≈ 3,5 d kode (SSO [Kan]) + DCA's beslutninger** (efter 1–11) | |

Venter på kunden (≈ 17 d): C-02-adapteren (e-conomic-login), udgående Dalux-synk + bilag (B-04,
B-05, B-08, B-09-rest), debitor (A-04, C-01-rest, C-03-rest, E-01-rest), momskodernes værdier,
niveaulisten (C-07), opbevaringstal (D-07).

## Top-5 at starte på

Rækkefølgen er afhængighedsstyret: hvert punkt låser det næste op.

1. **Udvid bookingen til et fakturagrundlag** — ~~A-05 kursister/niveau~~ og
   ~~A-02 faktureringsstatus~~ (begge bygget 2026-09-08), ~~A-07 afbestillingsårsag~~ og
   ~~A-06 ydelseskatalog + ydelseslinjer~~ (2026-09-09); tilbage står
   **rekvirent/kunde (debitor)** på bookingen. ~~Hændelsesloggen som rækketrigger~~
   (bygget 2026-09-10). ≈ 1,5 d.
2. ~~**Bookingrapport med filtre og eksport**~~ — E-01, E-03, E-04 bygget 2026-09-12; C-03, C-04,
   B-01 og D-06 løftet med. Tilbage: debitor som filter (spørgsmål 3) og afstemningsrapporten E-02.
3. ~~**Prisliste med tidsafgrænsede takster**~~ — C-05 er bygget 2026-09-11, inkl. takst pr.
   kursistniveau som grundlag for C-07. Snapshot ved fakturering følger med kladden i punkt 4.
4. ~~**Fakturakladde og godkendelse**~~ — bygget 2026-09-12: C-01, C-06 og C-10 er opfyldt, C-07
   og C-08 mangler kun kundens niveauliste og økonomirollen, og fakturanummeret registreres
   manuelt som bro til C-02. Faktureringsgevinsten er dermed i brug uden regnskabsintegrationen.
   Tilbage i afsnittet: C-02 (afventer systemvalg), C-09 kreditnota, C-03's periodeside (med E-01).
5. ~~**Historik for booking**~~ — D-05 og den læsbare før/efter i D-04 er bygget 2026-09-10.
   ~~D-06 eksport af historikken~~ er også bygget (CSV, PDF, Word), og rapport-eksporten fulgte
   med E-03 den 12. september.

Derefter: ~~A-04 bekræftelsesmails~~ (2026-09-08), ~~F-08 samlet dataudtræk~~ (2026-09-11),
~~B-05 første skive~~ (2026-09-11). Tilbage uden kundeafhængighed: F-01 økonomi-rolle, B-03
bookingimport, C-04's tælleflise på forsiden.

## Afklar med kunden nu

Svarene er forudsætning for at prissætte ≈ 28 dage, og de tager tid at få. Send spørgsmålene
samtidig med, at punkt 1–2 bygges.

1. ~~**Regnskabssystem**~~ — *afgjort: e-conomic*. Appen kan installeres nu; det, der mangler, er
   at EVU (eller DCA på en sandkasseaftale) installerer den og lægger AgreementGrantToken ind under
   Konfigurér → Integrationer → Regnskab, vælger debitor og produkter, og overfører én kladde.
2. **Dalux** (B-04..B-09) — *præciseret 2026-09-11 efter læsning af Dalux FM's API v2.5*:
   Dalux FM har **intet booking-objekt**. Objekterne er Estates, Buildings, Floors, Rooms, Assets,
   WorkOrders, Tickets, Invoices m.fl. Bed derfor om tre ting:
   - **En API-identitet på Dalux' stage-miljø** (`api.fm-stage.dalux.com`) fra EVU's
     Dalux-admin, med adgang til Rooms (læs) — så lokalerne kan synkroniseres med det samme.
   - **Hvilket objekt en booking bliver til** — arbejdsordre (WorkOrder: har tid, lokale,
     ansvarlig, status; DCA's anbefaling) eller sag (Ticket)? Og skal afregningslinjer ind som
     **Invoices**? Valget er et felt i Operias opsætning og kan ikke gættes.
   - **Navnet på det felt, der bærer lokalets navn**: et Dalux-rum har kun id, etage og arealer;
     navnet ligger i et af EVU's egne felter. Opsætningen viser listen efter forbindelsestesten.
   Import-arket (B-04): stadig ét eksporteret ark fra det valgte objekt, så kolonnemapningen kan
   fyldes ud.

   **Sendt til Dalux support 2026-09-13** (svar på deres "please elaborate"):

   > **Subject: Dalux FM API — integration for a shared customer (EVU): stage access and object mapping**
   >
   > DCA Logic is building an integration between our booking system (Operia) and Dalux FM for a
   > shared customer, EVU. The customer books rooms and invoices the bookings in Operia; the
   > requirement is a two-way integration with Dalux FM via your REST API — rooms flowing from
   > Dalux into Operia, and bookings and billing lines flowing from Operia into Dalux.
   >
   > We've read the Dalux FM API spec (v2.5.0 on SwaggerHub) and built the first half:
   > authentication with `X-API-KEY`, bookmark pagination, and a sync of `Rooms` → our resources,
   > tested against a mock of your API.
   >
   > 1. **Stage environment.** How do we get an API identity on `api.fm-stage.dalux.com` for
   >    development, before the customer's Dalux admin creates the production identity?
   > 2. **Object for bookings.** There is no booking/reservation resource in the FM API. For a room
   >    booking (room, start/end, responsible person, participants), would you recommend
   >    `WorkOrders` or `Tickets` — or is there a booking module not exposed in the API?
   > 3. **Object for billing lines.** Is `POST /2.0/invoices` the intended endpoint for an
   >    external system, or do customers handle invoicing outside Dalux?
   > 4. **Room names.** `Room` has no name property — is the name always in a user-defined field?
   > 5. **Limits.** Rate limits for `X-API-KEY` identities (error E42901) and a recommended sync
   >    frequency for a few hundred rooms / bookings per month?

   Svar 2 er det vigtigste: findes der et bookingmodul uden for API'et, bliver den udgående
   halvdel af B-05 til import-arket (B-03/B-04), ikke API-kald.
3. **Kunde/rekvirent (debitor)** — *det ene spørgsmål, der stadig ændrer datamodellen*: hvem
   skal fakturaen stiles til? Bookingen kender i dag en **medarbejder** (underviser/rekvirent) og
   dermed en **afdeling**; fakturakladden har to tomme debitorfelter, som ingen fylder. Tre svar
   giver tre forskellige byggerier:
   - *Interne afdelinger betaler* → debitor = afdelingen, udledt af medarbejderen. ½ dag.
   - *Eksterne kunder betaler* (CVR/EAN, fx kursisternes arbejdsgivere) → et kunderegister, en
     kunde pr. booking, vælger i bookingdialogen, én kladde pr. debitor ved samlet fakturering,
     kundefilter i rapporten. ≈ 2 d.
   - *Begge* → kunderegisteret med afdelingen som fallback. ≈ 2,5 d.
   Samme svar afgør, hvem "rekvirent" i A-04's bekræftelser er, og hvem der får
   faktureringsbeskeden. Og: er én fast kopiadresse (reception) nok, eller skal der være en
   deltagerliste pr. booking?
4. ~~**"Dag"**~~ — *afgjort som indstilling 2026-09-12*: Konfigurér → Booking → "Dagtælling i
   fakturakladden" vælger kalenderdage (standard) eller hverdage; en booking under et døgn tæller
   som én dag; timepris findes som takstenhed for ressourcer med klokkeslæt. Kunden skal ikke
   svare på noget — de skal højst flytte én vælger.
5. **Moms** — *felterne er bygget 2026-09-13*: momskode på ressourcekategori (lokalelinjen),
   kursistniveau (kursistlinjen) og tilkøbsydelse (tilkøbslinjen), som kunden selv vedligeholder
   og som arves af kladdens linjer. Tilbage er kun **værdierne**: hvilke koder bruger EVU's
   regnskab for lokaleleje, undervisning og forplejning? Når regnskabssystemet er valgt (C-02),
   hentes kodelisten derfra, så fri tekst bliver til et opslag.
6. **Kursistniveauer**: hvilke niveauer, og skal listen vedligeholdes af kunden? Selve listen er
   bygget som en tabel pr. kunde (A-05), så begge svar kan rummes — men den er TOM, indtil nogen
   siger hvad niveauerne hedder. Og: takst pr. niveau pr. ressource eller pr. ydelse?
7. **Fritekst i loggen** (D-04): formål og afbestillingsårsag logges som *at* de blev ændret,
   ikke med indhold — se D-04. Bekræft at det er den rigtige afvejning, eller bed om fuld
   før/efter og accepter, at teksten så ikke kan trækkes tilbage fra loggen igen.
8. **Opbevaringsperioden** (D-07). Mekanikken er bygget — ni kategorier med en platformstandard
   og et kundevindue hver, håndhævet natligt og selv auditeret — men **alle værdier er tomme**,
   så intet slettes i dag. Der mangler ikke kode, der mangler tal i aftalen. Bed om **to**:
   - *Revisionslog* (kategorien `audit`): hvor længe skal sporet over hvem der gjorde hvad bestå?
   - *Bookinger* (kategorien `bookings`): bookingens egne hændelser har ikke deres eget vindue —
     de følger bookingen og slettes sammen med den. Sættes bookingvinduet kortere end
     revisionsvinduet, forsvinder den detaljerede før/efter-historik, mens den spejlede
     revisionslinje består. De to tal skal derfor vælges sammen.

   To forbehold at tage med i samme ombæring: purgen ser ikke på `invoiced_at`, så et vindue
   kortere end bogføringslovens 5 år tager fakturagrundlaget med sig — enten respekterer den
   aftalte periode de 5 år, eller også skal purgen undtage fakturerede bookinger. Og
   acceptkriteriet handler om **tilgængelighed** ("data er tilgængelige i hele perioden"), så
   perioden er lige så meget en garanti til kunden som en grænse.
9. **Øvrige tal til aftalerne**: RPO/RTO (F-05), supportvindue (F-07), SSO via Entra ID
   ønskes? (F-06).

## Statuslegende

| Bånd | Betydning |
|---|---|
| Opfyldt (90–100 %) | Acceptkriteriet kan demonstreres i dag |
| Delvist (25–89 %) | Funktionen findes i begrænset form |
| Påbegyndt (5–24 %) | Intet for booking, men platformen har mønstret/infrastrukturen klar |
| Udvikling (0 %) | Findes ikke; leveres som afgrænset modul |

## A. Booking og ressourcestyring

| ID | Krav | Prio | Status | Vurdering | Estimat |
|-|---|-|--|----------|---|
| A-01 | Booking over sammenhængende periode | Skal | 100 % *(2026-09-12)* | Opfyldt: start/slut med klokkeslæt eller hele dage, kan spænde over flere døgn; vises i liste, kalender og **rapport** (E-01); dobbeltbooking blokeres i databasen (`bookings_no_overlap`). | 0 d |
| A-02 | Statusmodel booket → i brug → afsluttet → faktureret, automatisk | Skal | 100 % *(2026-09-12)* | Bygget. De tre første trin udledes af start/slut og skifter derfor af sig selv — intet cron-job, ingen indtastning. *Faktureret* er lagret (`bookings.invoiced_at`), sat af `set_booking_invoiced` (manager/booking_manager), og låser bookingen mod rettelse og annullering. Trinnet vises samlet i listen (sorterbar + filtrerbar kolonne) og i bookingdetaljen. Bevidst IKKE i `booking_status`-enum'en: den bærer dobbeltbookingsværnet (`where status = 'booked'`), og "annulleret efter fakturering" (C-09) er to kendsgerninger, ikke én. Sidste trin blev maskinelt med C-01: `transfer_invoice_draft` kalder `set_booking_invoiced` for hver booking på kladden, så *faktureret* sættes af faktureringen selv — klikket på den enkelte booking findes stadig som nødvej. | 0 d |
| A-03 | Genåbne og rette frem til fakturering | Skal | 100 % *(2026-09-12)* | Bygget helt igennem. Redigering frem til fakturering fandtes, og låsen ved overførsel (`booking_invoiced`) fandtes — det manglende led var **at en rettelse slår igennem på fakturagrundlaget**. Nu: rettes en booking, der ligger på en åben kladde (tid, ressource, kursister, niveau, tilkøb, afbestilling), stemples kladden *forældet*, en eventuel godkendelse trækkes tilbage, og hverken godkendelse eller overførsel kan ske, før kladden er dannet igen ("Dan igen": gammel annulleres, ny dannes med samme debitor og note, afbestilte bookinger udelades). Fritekst (formål, årsag) forælder ikke — den rører ikke beløbene. Håndhævet af triggere, så enhver vej ind i tabellen rammes. Efter overførsel gælder låsen, og vejen er kreditnota (C-09). Migration `20260912180000_invoice_draft_stale.sql`, fixtures `supabase/tests/invoice_draft_stale.sql`. Åbning fra rapporten: et klik på en række i Booking → Rapport åbner det samme detaljepanel som listen. | 0 d |
| A-04 | Bekræftelse ved oprettelse/ændring til rekvirent og modtagere | Bør | 85 % *(2026-09-08)* | Bygget. `dispatch-booking-notifications` læser hændelserne ud af `booking_events` og sender på alle fire kanaler; hver afsendelse logges i `booking_notifications`, fejl vises i Logs, og forbrug tælles med på kundens forbrugsside. Fem beskeder, skabeloner pr. platform og kunde, stilletid, dedup pr. hændelse, tre forsøg. Modtagere: medarbejderen, rekvirenten (`booked_by`, slås op som medarbejder) og en fast kopiadresse; faktureringsbeskeden går kun til fakturerings-postkassen. Resten af de 15 %: "rekvirent" er indtil videre den der oprettede bookingen — en egentlig rekvirent/debitor følger med E-01, og "relevante modtagere" er én adresse, ikke en deltagerliste. | 0 d (udvides med debitor-begrebet i E-01) |
| A-05 | Antal kursister og kursistniveau pr. booking | Skal | 100 % *(2026-09-12)* | Bygget. `bookings.participant_count` + `participant_level_id`, begge valgfri (ikke enhver booking er et kursus), udfyldes ved oprettelse og kan rettes frem til fakturering — låsen fra A-03 gælder også dem. Niveauerne er en tabel pr. kunde (`booking_participant_levels`) og ikke fri tekst, netop fordi C-07 skal hænge en takst på dem; listen vedligeholdes på Konfigurér → Booking. Et deaktiveret niveau kan ikke vælges, men bliver stående på bookinger der har det, og et niveau i brug kan ikke slettes (FK 'restrict'), så fakturagrundlaget ikke tømmes i det stille. Før/efter på begge felter står i hændelsesloggen (dækker C-10's sporbarhed). "Indgår i fakturagrundlaget" er demonstreret med C-01/C-07: kladden danner en linje pr. niveau med antal = kursister (× dage), og en ændring af antallet efter dannelsen forælder kladden (A-03). | 0 d |
| A-06 | Tilkøbsydelser med antal og enhedspris fra ydelsesliste | Skal | 100 % *(2026-09-13)* | Bygget. `booking_services` er kundens vedligeholdte ydelsesliste (navn, beskrivelse, med/uden antal, pris pr. enhed eller samlet beløb, aktiv/inaktiv) på siden Booking → Tilkøbsydelser; `booking_service_lines` er linjerne på bookingen med antal og **prissnapshot**, så en senere prisændring ikke rammer det, nogen allerede har godkendt (C-05). Tilføjes/rettes/fjernes via RPC'er, der gentjekker rettigheder og afviser en faktureret booking. En ydelse i brug kan ikke slettes, kun deaktiveres. **Momskode pr. ydelse** er bygget (2026-09-13) og arves af tilkøbslinjen på kladden; linjerne er fakturalinjer siden C-06. Momskoderne bor dér, hvor momsen afgøres — kategori (lokale), kursistniveau (undervisning), ydelse (tilkøb) — og vedligeholdes af kunden; Operia regner ikke moms. Værdierne er fri tekst, indtil regnskabssystemet (C-02) leverer kodelisten. | 0 d |
| A-07 | Afbestilling med tidspunkt, årsag og ansvarlig | Skal | 100 % *(2026-09-12)* | Alle tre led registreres: tidspunkt og ansvarlig stemples af serveren (`cancelled_at`/`cancelled_by`), og årsagen er nu et **påkrævet** felt (`cancellation_reason`) — en valgfri begrundelse ville stå tom i de fleste rækker, og så var kravet kun opfyldt på papiret. Afbestilling kræver manager/booking_manager (`can_cancel_bookings`); en booking_handler ser ikke knappen og afvises også server-side. Handlingen står i `booking_events`/`audit_log`, mens selve fritekst-årsagen bevidst kun bor på bookingen (audit_log er uforanderlig og videresendes til log drains). Årsagen søges af indsigtsudtrækket som pakkernes `removed_reason`. "Udgår af fakturagrundlaget" er demonstreret: generatoren springer afbestilte bookinger over (og siger det i svaret), og afbestilles en booking, der allerede ligger på en åben kladde, forældes kladden, og "Dan igen" udelader den (A-03). | 0 d |

## B. Integration til Dalux og Kundens FM-system

| ID | Krav | Prio | Status | Vurdering | Estimat |
|-|---|-|--|----------|---|
| B-01 | CSV-eksport af bookinger og afregningsdata fra rapporten | Skal | 90 % *(2026-09-12)* | Bygget. To rækkeformer, fordi kravet er to ting: **bookinger** (én række pr. booking med ydelsernes samlede beløb) og **afregningslinjer** (én række pr. tilkøbsydelse med antal, enhedspris og beløb). Formatprofiler — Operia (maskinlæsbar, ISO, punktum) og Excel (dansk: semikolon, komma-decimal) — plus valg af separator, decimaltegn, datoformat, kolonner og filnavn. Udtrækket **følger de anvendte filtre**: fra bookinglisten eksporteres de rækker søgning og kolonnefiltre viser, eller de markerede, hvis der er nogen. Hver eksport skriver `booking.exported` i revisionsloggen med udsnit, antal og kolonner — aldrig indholdet. Udtrækket dannes nu også **fra rapporten** (E-01) og følger dens filtre, som acceptkriteriet siger. Resten af de 10 %: **Dalux-profilen er tom** — se B-04. | 0,5 d (Dalux-profilen, efter skabelonen — Afklares) |
| B-02 | Eksport on-demand og planlagt | Skal | 90 % *(2026-09-13)* | Bygget. On-demand fandtes (B-01). **Planlagt**: Konfigurér → Booking → Planlagt eksport — dagligt/ugentligt/månedligt kl. X (dansk tid), periode (dagen/ugen/måneden før, seneste 30 dage), rækkeform og profil som den manuelle eksport, modtager. Edge-funktionen `booking-export-run` danner CSV'en serverside, lægger den i den private bucket `exports` under virksomhedens mappe, registrerer den i `booking_export_files` og sender modtageren et **signeret link** (7 dage) — ikke en vedhæftning, fordi et link kan trækkes tilbage. Filerne kan hentes igen fra siden (RLS på bucket'en). "Kør nu" kører samme funktion. Logget som `booking.exported` med udsnit `scheduled`. Resten: SFTP-push til kundens server, hvis FM-systemet ikke kan hente et link — kræver udgående SFTP i gateway'en. Edge-funktionen skal deployes. Migration `20260913180000_booking_scheduled_export.sql`. | 1 d (SFTP-push, hvis ønsket) |
| B-03 | Import af bookinger fra CSV med kolonnemapning | Skal | 90 % *(2026-09-13)* | Bygget. **Booking → Import**: fil → **kolonnemapning** (foreslået ud fra overskrifter, hver kolonne kan rettes i en vælger — det er svaret på et Dalux-ark, vi endnu ikke har set) → **tørkørsel** i basen (opslag af ressource på navn/Dalux-id, medarbejder på nr./e-mail/initialer/navn, niveau på navn; overlap mod basen OG inden for filen; låste bookinger) → anvend. Tid som Start/Slut eller Dato + tider, i **virksomhedens tidszone**, ikke browserens. `external_ref` gør importen idempotent: samme fil igen = uændret, rettet fil = opdatering, faktureret booking = afvist. Hver oprettelse går gennem `create_booking`/`update_booking`, så hændelseslog og beskeder rammer importen som et klik (D-02). Logges i Import → Log. Resten: det konkrete Dalux-ark (B-04) som gemt mapning. Migration `20260913150000_booking_import.sql`, fixtures `supabase/tests/booking_import.sql`. | 0,5 d (gemt mapningsprofil, når arket findes) |
| B-04 | Filformat og mapping dokumenteret og aftalt skriftligt | Skal | 20 % *(2026-09-10)* | Vores egen side er dokumenteret: kolonnerne findes i `lib/booking-export.ts` med maskinlæsbare nøgler, og Operia-profilen er selvbeskrivende. Det der mangler, er Dalux' side. **Dalux henter sin importskabelon fra Dalux selv** — man eksporterer et eksisterende objekt for at få arket, og kun visse felter kan importeres igen; deres import beskrives desuden som Excel, ikke CSV. Kolonnelayoutet afhænger derfor af, hvilket Dalux-objekt en booking skal blive til (B-08). Eksportdialogen har en synlig, deaktiveret "Dalux/FM"-profil, så pladsen er holdt. **Bed kunden om ét eksportark fra det objekt, de har i tankerne** — så er resten en kolonnemapning. | 1 d efter skabelonen — Afklares |
| B-05 | Direkte to-vejs-integration via Dalux REST-API | Skal | 35 % *(2026-09-11)* | Første skive bygget mod Dalux FM's API v2.5 (læst endpoint for endpoint på SwaggerHub): opsætning på Operia → Integrationer (udbud) og Konfigurér → Integrationer (kundens nøgle, miljø **produktion/stage**, objekter, tidsplan), forbindelsestest, og den **indgående** halvdel: **lokaler → ressourcer** med adoption af eksisterende ressourcer under samme navn (ingen dubletter) og `dalux_room_id` som eksternt id. Et Dalux-rum har intet navnefelt — navnet ligger i et af kundens egne felter, som vælges efter testen. **Udgående (bookinger, afregningslinjer) venter på B-08**: Dalux FM har intet booking-objekt, og valget (WorkOrder/Ticket, Invoices) er et felt i opsætningen, der skal sættes, før retningen kan slås til. Aktiver ind/ud er ikke bygget. Edge-funktionen `dalux-sync` skal deployes (`supabase functions deploy dalux-sync`). Migration `20260912150000_dalux_integration.sql`, fixtures `supabase/tests/dalux_integration.sql`. | 6–8 d — udgående bookinger + fakturaer efter kundens objektvalg, aktiver, stage-nøgle fra EVU |
| B-06 | API-nøgle (X-API-KEY) via rollestyret API-identitet | Skal | 90 % *(2026-09-11)* | Bygget efter Entra-mønstret: nøglen ligger i `company_dalux_secret` uden grants til klientrollerne, sættes og fjernes kun gennem edge-funktionen, og browseren ser kun "sat ✓" spejlet af en trigger. Udløbsdato gemmes (Dalux-nøgler udløber) og advares 14 dage før. Kunden kan selv tilbagekalde ("Fjern"), også hvis DCA har slået integrationen fra. Resten: at EVU's Dalux-admin faktisk opretter en API-identitet med afgrænset adgang — det er deres handling, ikke vores kode. | 0 d |
| B-07 | Konfigurerbar synkroniseringsfrekvens | Bør | 100 % *(2026-09-11)* | Opfyldt. Tidsplanen er data på kundens opsætning — kun manuelt, fast interval (15 min–12 t), dagligt, ugentligt eller månedligt, alle med klokkeslæt i dansk tid — og ét cron-job hvert 5. minut spørger `dalux_due_companies()` hvem der er forfalden. Planlagte kørsler kræver slået til + testet forbindelse. "Kør nu" ved siden af. | 0 d |
| B-08 | Datatyper og retning defineret pr. objekt i integrationsbilag | Skal | 30 % *(2026-09-11)* | Objekterne og retningerne er nu **afkrydsninger i opsætningen** frem for et bilag, der skrives bagefter: lokaler (Dalux → Operia, bygget), aktiver (begge veje, ikke bygget), bookinger (Operia → Dalux, **objekt skal vælges**: arbejdsordre eller sag), afregningslinjer (Operia → Dalux Invoices). Det manglende er kundens valg og selve bilagsteksten — se spørgsmål 2. | 1 d — Afklares |
| B-09 | Fejl logges, kan aflæses og gensendes uden datatab/dubletter | Skal | 80 % *(2026-09-11)* | Bygget som grundlag for alt, der senere udveksles: `dalux_sync_items` er én udboks med **idempotensnøgle** pr. post (`room:<id>`, unik pr. virksomhed), status, forsøg og sidste fejl; `dalux_sync_runs` er kørslerne med tællere. Fejllisten står på kundens opsætningsside med "Gensend", som sætter posten til afventer (næste kørsel gør forsøget, så gensend aldrig omgår kørslens logik og spor). Bevist: en omdøbning til et navn, en anden ressource har, giver `name_conflict` uden at røre ressourcen, og gensend + ny kørsel giver samme række, ikke to. Resten: fejlliste for de udgående objekter, når de findes. | 0,5 d (følger med udgående) |
| B-10 | Nøgler og hemmeligheder kun serverside | Skal | 100 % *(2026-09-11)* | Opfyldt. Dalux-nøglen følger nu samme mønster som Slack/Entra/e-conomic (B-06), og fixturen beviser, at klientrollen hverken kan læse hemmelighedstabellen eller forfalske "nøgle sat". | 0 d |

## C. Dataflow fra booking til afregning

| ID | Krav | Prio | Status | Vurdering | Estimat |
|-|---|-|--|----------|---|
| C-01 | Automatisk fakturakladde: lokale × antal dage × pris | Skal | 90 % *(2026-09-12)* | Bygget. **Bookinglisten → Dan fakturakladde** danner kladden ud fra det viste udvalg (markerede rækker, ellers hele det filtrerede sæt) — uden manuel indtastning af linjer, som acceptkriteriet kræver. Linjerne er lokale (takst × dagtælling), kursistniveau (C-07) og hvert tilkøb for sig (C-06). **Prisen er et snapshot** på linjen, så en senere takstændring ikke rører en dannet kladde. Kladden er **Operias egen og systemuafhængig**: `external_system` er 'manual', indtil en adapter sætter sit eget navn, og hele faktureringsgevinsten er derfor i brug, før regnskabsintegrationen findes. Siden **Booking → Fakturakladder** viser linjer, godkendelse, overførsel og annullering. Migration `20260912120000_invoice_drafts.sql`, fixtures `supabase/tests/invoice_drafts.sql` (8 prøver, inkl. regnestykket 3.600 + 11.100 + 5.700 = 20.400). Resten af de 10 %: **debitor** er stadig fri tekst, fordi bookingen kender en medarbejder og ikke en kunde (spørgsmål 3), og halve dage/timepris er en enhed, der kan vælges, men ikke afprøvet mod kundens virkelighed (spørgsmål 4). | 0,5 d (debitor, når svaret findes) |
| C-02 | Overførsel til regnskabssystem + fakturanummer skrives tilbage | Skal | 95 % *(2026-09-13)* | **Adapteren er bygget** (`economic-transfer`): en godkendt kladde oprettes som fakturakladde i e-conomic ud fra kundens egen skabelon (layout, betalingsbetingelser, momszone), med Operias linjer på de produktnumre, kunden har valgt under Konfigurér → Integrationer → Regnskab (debitor + ét produkt pr. linjetype, hentet fra e-conomic — aldrig tastet). Vores kladdenummer lægges i e-conomics referencefelt, og **fakturanummeret skrives tilbage**, når bogholderen har bogført ("Hent fakturanummer") — eller straks, med *automatisk bogføring* slået til. Kreditnotaer går samme vej (negative linjer). Idempotency-Key = kladdens id, så et netværksudfald ikke giver to kladder derovre. Alle skrivninger i Operia sker med kalderens rettigheder (økonomirollen). Prøvet mod e-conomics demo-aftale helt frem til POST (som demo ikke tillader). **Kørt mod en rigtig aftale 2026-09-13** (prøveaftale 2459977): FK-00003 overført som e-conomic-kladde nr. 1, bookingerne markeret faktureret og låst, `invoice_draft.transferred` i loggen. Første forsøg afslørede en fejl i adapteren (`p_invoice_no` sendt som *undefined* i stedet for *null* → PostgREST fandt ingen funktion), rettet samme dag sammen med genbrug af en allerede oprettet e-conomic-kladde via referencefeltet, så en fejlet overførsel aldrig giver to. Resten af de 5 %: bogføring i e-conomic → "Hent fakturanummer" — samme kald, prøvet mod demo-aftalen, ikke mod den rigtige endnu. Migration `20260913210000_economic_transfer.sql`. | 0,5 d (test mod rigtig aftale) |
| C-03 | Samlet fakturering af et filtreret udvalg | Skal | 95 % *(2026-09-12)* | Opfyldt med rapporten: periode, ressource, afdeling, status og faktureringsstatus afgrænser udvalget, og **"Dan fakturakladde"** fakturerer det viste (eller markerede) udvalg i én arbejdsgang. Udvalget ER gemt — det står i URL'en. Bookinglistens knap består. Resten: debitor som udvalgskriterium (spørgsmål 3). | 0 d |
| C-04 | Ingen afsluttet booking kan overses | Skal | 95 % *(2026-09-13)* | Bygget som E-04: rapportens forvalg "Afsluttet, ikke faktureret" + nøgletal, og faktureringskolonnen farver en afsluttet, ufaktureret booking i selve listen. Derfra er "Dan fakturakladde" ét klik. **Forsidens Booking-flise bærer nu tallet** (afsluttet, ikke faktureret, uden kladde) for de roller, der kan handle på det. Resten: en ugentlig påmindelse pr. mail — hører til i beskeddispatcheren og tages, når den alligevel deployes. | 0,25 d |
| C-05 | Priser pr. ressource og ydelse med tidsafgrænsede takster | Skal | 100 % *(2026-09-13)* | Bygget. `booking_tariffs` bærer takster pr. **ressource**, **tilkøbsydelse** og **kursistniveau** (sidstnævnte er grundlaget for C-07), hver med beløb, enhed, gyldighedsperiode og et frit momskodefelt. **Enheden er data, ikke antagelse** — `dag`, `time`, `kursist`, `kursist pr. dag`, `fast beløb` — så kundens svar på spørgsmål 4, 5 og 6 bliver en indtastning frem for en migration. To takster med samme enhed kan ikke gælde samtidig (exclusion-constraint, samme mekanik som dobbeltbookingsværnet), så prisopslaget har altid ét svar. Skærmen retter ikke en pris: den lukker den gamle takst dagen før og opretter den næste, hvilket ER acceptkriteriet "ændringer påvirker ikke allerede fakturerede bookinger". Fane **Priser** på ressource og ydelse, og en foldbar prisliste pr. niveau i Konfigurér → Booking. Hver ændring i sporet. Migration `20260911180000_booking_tariffs.sql`, fixtures `supabase/tests/booking_tariffs.sql`. Resten af de 15 %: **snapshot ved fakturering** hører til kladden i C-01, momskoden er flyttet fra taksten til kategori/niveau/ydelse (2026-09-13) — den følger tingen, ikke prisen. | 0 d |
| C-06 | Tilkøb som særskilte fakturalinjer | Skal | 100 % *(2026-09-12)* | Opfyldt. Hver tilkøbsydelse på bookingen bliver til sin egen kladdelinje med ydelsens navn som tekst, sit antal og sin **snapshot-pris** — den pris, der blev låst, da ydelsen blev sat på bookingen, ikke katalogets nuværende. Forplejning, overnatning, rengøring og øvrige tilkøb står dermed som selvstændige linjer, præcis som acceptkriteriet beskriver. | 0 d |
| C-07 | Beregning pr. kursist, differentieret på niveau | Skal | 90 % *(2026-09-12)* | Bygget. Kursistniveauet har sin egen takst (C-05, scope `level`), og kladden danner en linje pr. niveau med antal = kursister (enhed `kursist`) eller kursister × dage (enhed `kursist pr. dag`). Både antal og niveau indgår dermed i linjebeløbet. Resten af de 10 %: hvilke niveauer og hvilken enhed kunden vil bruge, er stadig spørgsmål 6 — listen er tom, indtil de svarer. | 0 d (afventer niveaulisten fra kunden) |
| C-08 | Godkendelsestrin før fakturering | Bør | 100 % *(2026-09-13)* | Bygget. En kladde skal godkendes, før den kan overføres: `approve_invoice_draft` sætter status, godkender og tidspunkt, og handlingen står i loggen (`invoice_draft.approved`). Med økonomirollen (F-01, 2026-09-13) er "en ansvarlig frigiver" ikke længere "en bookingansvarlig frigiver": godkendelse og overførsel kræver manager eller finance_manager, og booking_manager afvises server-side. | 0 d |
| C-09 | Kreditnota ved afbestilling/nedjustering efter fakturering | Skal | 90 % *(2026-09-13)* | Bygget. "Opret kreditnota" på en overført faktura: **hele fakturaen** eller **et udvalg af linjer med antal**. Kreditnotaen er en kladde af arten `credit` (KN-nummer) med reference til fakturaen og negative linjer, og følger samme godkendelse og overførsel — ét spor. Er hele beløbet krediteret, løftes låsen på bookingerne, så de kan rettes og faktureres igen (C-10's "ikke en stille korrektion"); en delvis kreditnota lader fakturaen stå med et fradrag. Én kreditnota ad gangen pr. faktura; en krediteret faktura kan ikke krediteres igen. Vises i afstemningen som negative rækker. Overførslen gennem e-conomic-adapteren (C-02) er den samme som for fakturaer — negative linjer er e-conomics egen kreditnotaform. Resten: én kreditnota overført til den rigtige e-conomic-aftale (fakturaen er derovre nu — det er ét klik). | 0 d |
| C-10 | Ændret deltagerantal slår igennem, sporbart | Skal | 100 % *(2026-09-12)* | Opfyldt. Ændres deltagerantallet, skrives før/efter i `booking_events` (A-05/D-04), og fordi kladden dannes **efter** bookingen er afsluttet, regner den på det antal, der står på bookingen på det tidspunkt. Er kladden allerede dannet, er bookingen knyttet til den og kan ikke komme på en ny, før kladden annulleres — så en ændring efter fakturering er en kreditnota (C-09) og ikke en stille korrektion. | 0 d |

## D. Sporbarhed, ændringslog og dokumentation

| ID | Krav | Prio | Status | Vurdering | Estimat |
|-|---|-|--|----------|---|
| D-01 | Automatisk ændringslog med dato, bruger, type og før/efter | Skal | 90 % *(2026-09-10)* | Rækketriggeren `audit_bookings_row` skriver hver oprettelse, ændring, statusskift, fakturering og sletning i `booking_events` (spejlet til `audit_log`) med tidspunkt, bruger og før/efter. Diffen dækker nu **alle** strukturelle felter — også heldag og status, som RPC'en aldrig skrev — og kun de felter der faktisk ændrede sig kommer med, så loggen er læsbar. Et gem uden ændringer giver ingen hændelse længere. Sletning: en booking kan i praksis ikke slettes ud af det blå (fremmednøglen fra hændelserne er 'restrict', og hændelserne kan ikke slettes), og opbevaringspurgen logger sin egen optælling; triggeren har en sletningsgren som bagstopper. Resten af de 10 %: godkendelse (C-08) findes ikke, og fritekst er bevidst holdt ude — se D-04. | 0 d (godkendelse følger med C-08) |
| D-02 | Loggen fanges på databaseniveau, kan ikke omgås | Skal | 100 % *(2026-09-10)* | Opfyldt. Loggen sidder som `after insert or update or delete ... for each row` på `bookings`, og RPC'erne skriver ikke længere selv. En ændring foretaget uden om brugerfladen — rå SQL, service-rolle, migration, edge-funktion — giver nøjagtig samme hændelse som et klik i UI'et; er der ingen indlogget bruger, står handlingen med tom aktør, hvilket i sig selv er oplysningen. Bevist i `supabase/tests/booking_audit_trigger.sql` trin 4. Aktøren vises ved navn — også når det var en DCA-platform-admin, der over for kunden står som organisationen (`audit_actor_names`, 2026-09-11). | 0 |
| D-03 | Logposter kan ikke redigeres/slettes af brugere | Skal | 100 % *(efterprøvet 2026-09-10)* | Opfyldt — men efterprøvningen fandt en revne, der nu er lukket. Beskyttelsen hvilede på tre lag: RLS uden skrivepolitik, tilbagekaldt UPDATE/DELETE, og `block_mutation` på hændelsestabellerne. Rettighederne fra Supabases standard-`grant all` var derimod aldrig trimmet: `authenticated` havde stadig **TRUNCATE** på alle syv logtabeller, INSERT på hændelsestabellerne og fuld DML på de tre beskedlogge. TRUNCATE er den alvorlige — RLS gælder ikke for den, og `block_mutation` er en rækketrigger, som derfor aldrig fyrer. Den kunne ikke nås gennem PostgREST (ingen TRUNCATE-metode), men acceptkriteriet siger "skrivebeskyttet for alle roller". Alt overskydende er nu tilbagekaldt og efterprøvet ved faktisk at sætte rollen og forsøge. Beskedloggene får bevidst ingen immutabilitetstrigger: de opdateres lovligt af bounce-tilbagemeldinger fra e-mailudbyderen. Læseadgangen er samtidig strammet fra tenant-grænsen alene til ansvarsrollerne: `booking_events` kræver manager/booking_manager, `audit_log` en ansvarsrolle. Håndterere kan altså hverken se eller ændre loggen — før kunne de læse hele virksomhedens spor gennem APIet, selv om siden var lukket for dem. | 0 |
| D-04 | Ændringer aflæses med konsekvens for leverance og fakturering | Skal | 95 % *(2026-09-13)* | Kravet er to ting. **Leverancekonsekvensen** er dækket: hver ændring af ressource, tidsrum, deltagerantal, niveau og tilkøbsydelser står med før/efter, og historiksiden (D-05) viser den læsbart med navne i stedet for id'er. **Beløbskonsekvensen** vises i en egen kolonne, men kun for tilkøbsydelser — de er det eneste med en pris på sig i dag (rettet 2026-09-10: `service_updated` manglede prisen, så en antalsændring ikke kunne omsættes til kroner). For lokale, antal dage og kursistniveau står kolonnen tom med "—" frem for 0 kr., fordi "ingen konsekvens" og "kan ikke gøres op endnu" ikke er det samme; den fyldes ud, når takstlisten (C-05) og fakturagrundlaget (C-01) findes. Fritekstfelterne står som "ændret" uden værdier — aftalt afvigelse, se spørgsmål 7. **Beløbskonsekvensen er nu komplet** (2026-09-13): hændelsen bærer selv `amount_from`/`amount_to` for lokale + kursister, regnet af triggeren på taksterne som de gjaldt på startdatoen — så en flyttet booking, et ændret kursistantal og en afbestilling står i kroner i historikkens beløbskolonne, ligesom tilkøbene. | 0 d |
| D-05 | Samlet historik med filtrering på periode, booking og bruger | Skal | 95 % *(2026-09-10)* | Bygget. **Booking → Historik** viser hele ændringsloggen med de tre filtre kravet nævner: periode (fra/til, afgrænset i basen), bruger (vælger over de aktører der optræder) og booking (fritekstsøgning på ressource, formål, medarbejder og booking-id — den, der leder, husker lokalet, ikke et UUID). Dertil kolonnefilter på handlingstype, sortering og sidevisning. Den enkelte booking har sin egen **historik-fane** i detaljepanelet. Ændringer, der er sket uden om brugerfladen, står med "Uden om brugerfladen" som bruger — D-02 gjort synlig. Resten af de 5 %: udtrækket er begrænset til 500 rækker pr. forespørgsel; serverside-paginering, hvis en kunde får brug for mere. | 0,5 d (paginering, når volumen kræver det) |
| D-06 | Historik og rapporter til CSV og PDF | Skal | 90 % *(2026-09-12)* | **Historikken** kan eksporteres i CSV, PDF og **Word** — kravet nævner to formater, det tredje kostede ingenting, fordi renderen fandtes. Udskriften indeholder de filtrerede poster i læsbar form: navne i stedet for id'er, ændringer som "felt: før → efter", et nøgletalsafsnit (antal ændringer, heraf med beløb, tillæg, fradrag, netto) og de anvendte filtre i sidehovedet, så en udskrift dokumenterer sit eget udsnit. Hver eksport logges som `booking.exported`. **Rapporten** kan nu også: bookingrapporten (E-01) eksporteres til CSV og PDF (E-03). Resten: afstemningsrapporten (E-02). | 0 d |
| D-07 | Opbevaringsperiode aftalt og overholdt | Skal | 70 % | Mekanisme findes: opbevaringsvinduer pr. kunde for revisionslog og bookinger, håndhævet natligt og selv auditeret. Værdier er ikke aftalt. Bemærk: booking-hændelser slettes sammen med bookingen; loggens eget vindue skal derfor mindst være lige så langt. | 0,5 d — aftale værdier, ind i DPA-bilag |

## E. Rapportering og afstemning

| ID | Krav | Prio | Status | Vurdering | Estimat |
|-|---|-|--|----------|---|
| E-01 | Rapport med kombinerbare filtre: periode, ressource, afdeling/kunde, bookingstatus, faktureringsstatus | Skal | 85 % *(2026-09-12)* | Bygget. **Booking → Rapport**: periode (overlap, ikke kun start), ressource, **afdeling** (via medarbejderen), bookingstatus (A-02's fem trin) og faktureringsstatus i tre tilstande — ikke faktureret / på kladde / faktureret — som kan kombineres frit. **Filtrene ligger i URL'en**, så en rapport er et link, der kan sendes og gemmes. Nøgletal øverst (antal, afsluttet-ikke-faktureret, på kladde, faktureret, tilkøb i alt), sortering, søgning og kolonnefiltre. Bookingen åbnes i detaljepanelet fra rapporten (A-01/A-03), det viste udvalg kan faktureres i én arbejdsgang (C-03) og eksporteres til CSV og PDF (E-03). Loft 2.000 rækker med besked. Resten af de 15 %: **kunde/debitor** som filter — begrebet findes ikke på bookingen endnu (spørgsmål 3). | 0,5 d (debitorfilter, når begrebet findes) |
| E-02 | Afstemningsrapport booking → fakturanummer | Skal | 95 % *(2026-09-13)* | Bygget. **Booking → Afstemning**: én række pr. booking pr. kladde med kladdenr., status, fakturanr., overførselsdato og beløb; kreditnotaer som negative rækker; nøgletal faktureret/krediteret/netto/åbent. Perioden gælder **overførselsdatoen** ("hvad blev faktureret i september"), fordi det er dét, man afstemmer. CSV og PDF, logget. Filtrene i URL'en. Resten: debitorkolonnen fyldes, når debitorbegrebet findes. | 0 d |
| E-03 | Rapporter til CSV og PDF | Skal | 90 % *(2026-09-12)* | Bygget for bookingrapporten: **CSV** gennem den eksisterende eksportdialog (rækkeform, profil, kolonner) og **PDF** gennem rapportrenderen med nøgletal, de anvendte filtre i sidehovedet og tabellen som på skærmen. Begge følger rapportens filtre og markering, og begge logges (`booking.exported`, udsnit `report`). Historikken (D-06) kunne allerede. Resten: afstemningsrapporten (E-02) findes ikke endnu. | 0 d (E-02's eksport følger med E-02) |
| E-04 | Oversigt over ikke-fakturerede, afsluttede bookinger | Bør | 100 % *(2026-09-12)* | Opfyldt. Knappen **"Afsluttet, ikke faktureret"** på rapporten sætter de to filtre i ét klik, kombineret med den valgte periode; nøgletallet med samme navn står øverst og farves, når det er over nul. | 0 d |

## F. Drift, sikkerhed og support

| ID | Krav | Prio | Status | Vurdering | Estimat |
|-|---|-|--|----------|---|
| F-01 | Rollestyret adgang: booking, drift, økonomi, administration | Skal | 95 % *(2026-09-13)* | **Økonomirollen er bygget**: `finance_manager` godkender og overfører kladder, opretter kreditnotaer og læser rapport og afstemning — men booker ikke. `booking_manager` kan stadig danne, rette og annullere kladder, men *ikke* godkende eller overføre (håndhævet i RPC'erne, ikke kun i skærmen). Roller pr. bruger, sideadgang i kode, log-læsning i rækkerne (2026-09-10). Resten: drift/administration er `manager` og platform-admin som hidtil. | 0 d |
| F-02 | Browser uden lokal installation | Skal | 100 % | Web-app (SPA) på operia.predictioninstitute.com. | 0 |
| F-03 | GDPR og databehandleraftale | Skal | 70 % | Teknik stærk: tenant-isolation, uforanderlig log, anonymisering, opbevaring, indsigtsudtræk. DPA foreligger som udkast (DCA-DPA-1.0 på Datatilsynets standardbestemmelser), ikke juridisk gennemgået, ikke underskrevet; databeskyttelsesansvarlig ikke navngivet. | 1–2 d DCA-arbejde + ekstern juridisk gennemgang |
| F-04 | Hosting i EU/EØS, dokumenteret | Skal | 85 % *(2026-09-13)* | Supabase i AWS eu-north-1 (Stockholm), dokumenteret i underdatabehandlerregister og DPA-bilag C.5; **EU-mailudbyder (Brevo) valgbar siden 2026-09-08**. Samlet i `docs/drift-og-support.md` §1. Åbent: regionen for DCA's egen web/gateway-server skal bekræftes og skrives ind — én oplysning, DCA har. | 0 d (én bekræftelse) |
| F-05 | Backup og aftalte RPO/RTO | Skal | 45 % *(2026-09-13)* | DR-runbook findes (genskabelse fra git). **Driftsaftalens tal er nu formuleret** i `docs/drift-og-support.md` §2 med de valg, DCA skal træffe: planopgradering (daglig backup / PITR), RPO, RTO og en gendannelsestest med logbog. Supabase kører stadig på gratisplan uden automatisk backup — det er en driftsomkostning, ikke kode. | 0,5 d opsætning + 1 d gendannelsestest (efter DCA's valg) |
| F-06 | SSO via kundens identitetsstyring | Kan | 10 % | Ingen SSO. Entra ID bruges kun til medarbejdersynk. Supabase Auth understøtter Entra/Azure som login-udbyder. | 3–4 d — udbyder, login pr. kundedomæne, kobling til brugere, håndhævelse pr. kunde |
| F-07 | Support inden for aftalt vindue | Skal | 40 % *(2026-09-13)* | Aftaleteksten er udkastet i `docs/drift-og-support.md` §3–4 (vindue, kanaler, reaktionstider, vedligehold, hvad kunden selv kan). Tallene er markeret **[DCA afgør]** — de er forretning, ikke teknik. | 0,25 d (tal + gennemlæsning) |
| F-08 | Udlevering af data ved ophør i anvendeligt format | Skal | 100 % *(2026-09-11)* | Bygget. **Kunder → Handlinger → Fuldt dataudtræk** danner en ZIP med én CSV pr. tabel, mappelagt efter produkt, plus `manifest.json` (rækketal pr. tabel, så pakken kan kontrolleres for fuldstændighed) og en læsevejledning. Grupperne er kerne + de otte produkter; kernen er slået til på forhånd, fordi de øvrige filer ellers kun rummer id'er. Udvælgelsen er en hvidliste i basen (`company_export_catalog`) — klienten kan ikke navngive en tabel, der ikke står der, og hemmelighedstabellerne står der ikke. Integrationsnøgler i almindelige tabeller maskeres. Kunden kan selv trække sin kopi (manager/data_manager), og hvert udtræk logges som `privacy.full_export` på niveau warning. Migration `20260911120000_company_full_export.sql`, fixtures `supabase/tests/company_full_export.sql`. **Filerne følger med** (tilstandsfotos, underskrifter, aktivbilag, designbilleder) i mappen `filer/`, listet i `filer.csv` med størrelse og status — også de stier, hvis fil ikke længere findes, så en manglende fil er en oplysning og ikke en tavshed. Loftet er 150 MB pr. pakke, fordi ZIP'en bygges i browserens hukommelse; rammes det, står resten som `skipped_budget`. Ikke med: `imports`-bucket'en (rå HR-filer, slettes efter 30 dage, indholdet står allerede i `employees`) og `feedback` (DCA-intern). Migration `20260911150000_company_export_files.sql`. | 0 d |

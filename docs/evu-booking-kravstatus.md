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
| A. Booking og ressourcestyring | 7 | 84 % | ≈ 1 d |
| B. Integration til Dalux/FM | 10 | 21 % | ≈ 32 d (≈ 20 d blokeret på Dalux-adgang) |
| C. Dataflow booking → afregning | 10 | 20 % | ≈ 23 d (≈ 7 d blokeret på valg af regnskabssystem) |
| D. Sporbarhed og ændringslog | 7 | 84 % | ≈ 6 d |
| E. Rapportering og afstemning | 4 | 14 % | ≈ 7 d |
| F. Drift, sikkerhed og support | 8 | 58 % | ≈ 10 d (heraf ≈ 4 d aftaletekst, ikke udvikling) |
| **I alt** | **46** | **46 %** | **≈ 79 d** — ≈ 51 d kan startes nu, ≈ 28 d afventer kunden |

Fordeling: 9 opfyldt (≥ 90 %), 16 delvist (25–89 %), 11 påbegyndt (5–24 %), 10 mangler (0–4 %). Ved førstevurderingen 5. september: 3 / 13 / 13 / 17.

Det bærende fund fra 5. september var, at **bookingkernen var solid, men alt der handlede om penge manglede**. Det halve er indhentet: bookingen bærer nu status, kursister, afbestillingsårsag og tilkøbsydelser med priser, og der kan eksporteres. Tilbage står de tre led, der kræver svar fra kunden frem for kode — **debitor** (hvem faktureres), **moms**, og **hvilke systemer** der skal modtage data (Dalux-objekt og regnskabssystem) — plus selve fakturakladden i afsnit C, som ikke kan bygges færdig uden dem. Kravspecifikationens afsnit 5.1 ("Nuværende flow") beskriver stadig en løsning, der ikke er bygget, og bør rettes, inden dokumentet sendes til kunden.

## Top-5 at starte på

Rækkefølgen er afhængighedsstyret: hvert punkt låser det næste op.

1. **Udvid bookingen til et fakturagrundlag** — ~~A-05 kursister/niveau~~ og
   ~~A-02 faktureringsstatus~~ (begge bygget 2026-09-08), ~~A-07 afbestillingsårsag~~ og
   ~~A-06 ydelseskatalog + ydelseslinjer~~ (2026-09-09); tilbage står
   **rekvirent/kunde (debitor)** på bookingen. ~~Hændelsesloggen som rækketrigger~~
   (bygget 2026-09-10). ≈ 1,5 d.
2. **Bookingrapport med filtre og eksport** — E-01, E-03, E-04, C-04, B-01 (on-demand). Periode,
   ressource, afdeling/kunde, bookingstatus, faktureringsstatus; CSV/PDF via den eksisterende
   rapportrenderer. ≈ 5–6 d. Rapporten er navet, som A-01, A-03, B-01, C-03 og E-02 henviser til.
3. ~~**Prisliste med tidsafgrænsede takster**~~ — C-05 er bygget 2026-09-11, inkl. takst pr.
   kursistniveau som grundlag for C-07. Snapshot ved fakturering følger med kladden i punkt 4.
4. **Fakturakladde og godkendelse** — C-01, C-06, C-07, C-10, lås efter fakturering (A-03), C-08
   godkendelsestrin, C-03 samlet kørsel, plus *manuel* registrering af fakturanummer som bro til
   C-02. ≈ 11–12 d. Leverer "faktureringsgevinsten" uden at vente på regnskabsintegrationen.
5. ~~**Historik for booking**~~ — D-05 og den læsbare før/efter i D-04 er bygget 2026-09-10.
   ~~D-06 eksport af historikken~~ er også bygget (CSV, PDF, Word). Tilbage: rapport-eksporten,
   som følger med E-03.

Derefter: ~~A-04 bekræftelsesmails~~ (bygget 2026-09-08), B-03 bookingimport, F-01 økonomi-rolle,
F-08 samlet dataudtræk.

## Afklar med kunden nu

Svarene er forudsætning for at prissætte ≈ 28 dage, og de tager tid at få. Send spørgsmålene
samtidig med, at punkt 1–2 bygges.

1. **Regnskabssystem** (C-02): hvilket system, hvilken grænseflade (API/fil), og hvordan kommer
   fakturanummeret tilbage? Fx e-conomic, Dynamics 365 BC, Navision Stat.
2. **Dalux** (B-04..B-09): API-adgang og sandbox; hvilke Dalux-objekter svarer til "booking" og
   "afregningslinje" — Dalux FM er et FM-system, ikke et bookingsystem. Hvad udveksles i dag?
   **Konkret og billigt første skridt:** bed dem eksportere ét ark fra det objekt, bookinger skal
   lande i. Dalux' import bruger sin egen skabelon, så det ark ER feltmapningen (B-04), og
   eksportprofilen kan fyldes ud på en dag.
3. **Kunde/rekvirent**: er modparten på en booking en ekstern kunde (debitor med CVR/EAN) eller en
   intern afdeling? Faktura kræver en debitor; i dag bookes der for en *medarbejder*. Samme svar
   afgør, hvem "rekvirent" i A-04 er: indtil videre sendes bekræftelsen til den, der oprettede
   bookingen. Og hvem skal have booking-beskeder ud over medarbejderen — er én fast kopiadresse
   (reception) nok, eller skal der være en deltagerliste pr. booking?
4. **"Dag"** i lokale × antal dage × pris: kalenderdage, hverdage, halve dage? Timepris for
   ressourcer med klokkeslæt?
5. **Moms**: momsfri undervisning vs. momspligtige tilkøb (forplejning)? Momskode pr. linje.
   Ydelseskataloget (A-06) er bygget UDEN momskode, netop fordi svaret afgør, om den hører til
   pr. ydelse, pr. linje eller pr. kunde. Feltet er en halv dags arbejde, når det er afklaret.
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
| A-01 | Booking over sammenhængende periode | Skal | 90 % | Opfyldt: start/slut med klokkeslæt eller hele dage, kan spænde over flere døgn; vises i liste og kalender; dobbeltbooking blokeres i databasen (`bookings_no_overlap`). Mangler kun, at bookingen også fremgår af *rapportoversigten*, som ikke findes endnu (E-01). | 0 d (dækkes af E-01) |
| A-02 | Statusmodel booket → i brug → afsluttet → faktureret, automatisk | Skal | 75 % *(2026-09-08)* | Bygget. De tre første trin udledes af start/slut og skifter derfor af sig selv — intet cron-job, ingen indtastning. *Faktureret* er lagret (`bookings.invoiced_at`), sat af `set_booking_invoiced` (manager/booking_manager), og låser bookingen mod rettelse og annullering. Trinnet vises samlet i listen (sorterbar + filtrerbar kolonne) og i bookingdetaljen. Bevidst IKKE i `booking_status`-enum'en: den bærer dobbeltbookingsværnet (`where status = 'booked'`), og "annulleret efter fakturering" (C-09) er to kendsgerninger, ikke én. Resten af de 25 %: markeringen sættes i dag ved et klik — den bliver først maskinel, når faktureringskørslen (C-01/C-03) kalder samme RPC. | 0 d (sidste trin følger med C-01/C-03) |
| A-03 | Genåbne og rette frem til fakturering | Skal | 70 % *(2026-09-08)* | Redigering af aktive bookinger findes (ressource, medarbejder, tid, titel), også efter afholdelse (`update_booking`), og **låsen ved fakturering er bygget** — `update_booking` og `cancel_booking` afviser en faktureret booking med `booking_invoiced`. Mangler: åbning fra rapporten, og at rettelser slår igennem på et fakturagrundlag. | 0,5 d (+ afhænger af C-01) |
| A-04 | Bekræftelse ved oprettelse/ændring til rekvirent og modtagere | Bør | 85 % *(2026-09-08)* | Bygget. `dispatch-booking-notifications` læser hændelserne ud af `booking_events` og sender på alle fire kanaler; hver afsendelse logges i `booking_notifications`, fejl vises i Logs, og forbrug tælles med på kundens forbrugsside. Fem beskeder, skabeloner pr. platform og kunde, stilletid, dedup pr. hændelse, tre forsøg. Modtagere: medarbejderen, rekvirenten (`booked_by`, slås op som medarbejder) og en fast kopiadresse; faktureringsbeskeden går kun til fakturerings-postkassen. Resten af de 15 %: "rekvirent" er indtil videre den der oprettede bookingen — en egentlig rekvirent/debitor følger med E-01, og "relevante modtagere" er én adresse, ikke en deltagerliste. | 0 d (udvides med debitor-begrebet i E-01) |
| A-05 | Antal kursister og kursistniveau pr. booking | Skal | 90 % *(2026-09-08)* | Bygget. `bookings.participant_count` + `participant_level_id`, begge valgfri (ikke enhver booking er et kursus), udfyldes ved oprettelse og kan rettes frem til fakturering — låsen fra A-03 gælder også dem. Niveauerne er en tabel pr. kunde (`booking_participant_levels`) og ikke fri tekst, netop fordi C-07 skal hænge en takst på dem; listen vedligeholdes på Konfigurér → Booking. Et deaktiveret niveau kan ikke vælges, men bliver stående på bookinger der har det, og et niveau i brug kan ikke slettes (FK 'restrict'), så fakturagrundlaget ikke tømmes i det stille. Før/efter på begge felter står i hændelsesloggen (dækker C-10's sporbarhed). Resten af de 10 %: "indgår i fakturagrundlaget" kan først demonstreres, når C-01 findes. | 0 d (afsluttes med C-01/C-07) |
| A-06 | Tilkøbsydelser med antal og enhedspris fra ydelsesliste | Skal | 90 % *(2026-09-09)* | Bygget. `booking_services` er kundens vedligeholdte ydelsesliste (navn, beskrivelse, med/uden antal, pris pr. enhed eller samlet beløb, aktiv/inaktiv) på siden Booking → Tilkøbsydelser; `booking_service_lines` er linjerne på bookingen med antal og **prissnapshot**, så en senere prisændring ikke rammer det, nogen allerede har godkendt (C-05). Tilføjes/rettes/fjernes via RPC'er, der gentjekker rettigheder og afviser en faktureret booking. En ydelse i brug kan ikke slettes, kun deaktiveres. Resten af de 10 %: **momskode pr. ydelse** mangler — den afventer momsspørgsmålet (spørgsmål 5), og linjerne bliver først til fakturalinjer med C-06. | 0,5 d (momskode, efter afklaring) |
| A-07 | Afbestilling med tidspunkt, årsag og ansvarlig | Skal | 85 % *(2026-09-09)* | Alle tre led registreres: tidspunkt og ansvarlig stemples af serveren (`cancelled_at`/`cancelled_by`), og årsagen er nu et **påkrævet** felt (`cancellation_reason`) — en valgfri begrundelse ville stå tom i de fleste rækker, og så var kravet kun opfyldt på papiret. Afbestilling kræver manager/booking_manager (`can_cancel_bookings`); en booking_handler ser ikke knappen og afvises også server-side. Handlingen står i `booking_events`/`audit_log`, mens selve fritekst-årsagen bevidst kun bor på bookingen (audit_log er uforanderlig og videresendes til log drains). Årsagen søges af indsigtsudtrækket som pakkernes `removed_reason`. Resten af de 15 %: "udgår af fakturagrundlaget" kan først demonstreres, når C-01 findes — i dag udgår bookingen af dobbeltbookingsværnet og af de aktive lister. | 0 d (afsluttes med C-01) |

## B. Integration til Dalux og Kundens FM-system

| ID | Krav | Prio | Status | Vurdering | Estimat |
|-|---|-|--|----------|---|
| B-01 | CSV-eksport af bookinger og afregningsdata fra rapporten | Skal | 75 % *(2026-09-10)* | Bygget. To rækkeformer, fordi kravet er to ting: **bookinger** (én række pr. booking med ydelsernes samlede beløb) og **afregningslinjer** (én række pr. tilkøbsydelse med antal, enhedspris og beløb). Formatprofiler — Operia (maskinlæsbar, ISO, punktum) og Excel (dansk: semikolon, komma-decimal) — plus valg af separator, decimaltegn, datoformat, kolonner og filnavn. Udtrækket **følger de anvendte filtre**: fra bookinglisten eksporteres de rækker søgning og kolonnefiltre viser, eller de markerede, hvis der er nogen. Hver eksport skriver `booking.exported` i revisionsloggen med udsnit, antal og kolonner — aldrig indholdet. Resten af de 25 %: "rapporten" i acceptkriteriet er E-01, som endnu ikke findes (i dag er listen indgangen), og **Dalux-profilen er tom** — se B-04. | 0,5 d (kobles på E-01) |
| B-02 | Eksport on-demand og planlagt | Skal | 5 % | On-demand følger af B-01. Planlagt eksport findes ikke for noget modul: CSV dannes i browseren i dag, og der er ingen udgående fil-levering. | 4–6 d — serverside CSV-generator, tidsplan pr. kunde, levering via SFTP-push, e-mail-vedhæftning eller download-link |
| B-03 | Import af bookinger fra CSV med kolonnemapning | Skal | 15 % | Generisk importmotor (upload → tørkørsel → anvend, header-genkendelse via aliasser, konfigurerbar kolonnerækkefølge) findes for aktiver/lager. Bookinger kræver opslag af ressource/medarbejder, tidsparsing, overlap-rapport i tørkørslen og et eksternt id, så gen-import ikke giver dubletter. Egentlig mapnings-UI (kolonne → felt) findes ikke. | 4–5 d (+ 1,5 d for eksplicit mapnings-UI) |
| B-04 | Filformat og mapping dokumenteret og aftalt skriftligt | Skal | 20 % *(2026-09-10)* | Vores egen side er dokumenteret: kolonnerne findes i `lib/booking-export.ts` med maskinlæsbare nøgler, og Operia-profilen er selvbeskrivende. Det der mangler, er Dalux' side. **Dalux henter sin importskabelon fra Dalux selv** — man eksporterer et eksisterende objekt for at få arket, og kun visse felter kan importeres igen; deres import beskrives desuden som Excel, ikke CSV. Kolonnelayoutet afhænger derfor af, hvilket Dalux-objekt en booking skal blive til (B-08). Eksportdialogen har en synlig, deaktiveret "Dalux/FM"-profil, så pladsen er holdt. **Bed kunden om ét eksportark fra det objekt, de har i tankerne** — så er resten en kolonnemapning. | 1 d efter skabelonen — Afklares |
| B-05 | Direkte to-vejs-integration via Dalux REST-API | Skal | 0 % | Intet. Kræver API-adgang, sandbox og afklaring af hvilke Dalux-objekter der svarer til bookinger og afregningslinjer. | 10–15 d — Afklares (blokeret) |
| B-06 | API-nøgle (X-API-KEY) via rollestyret API-identitet | Skal | 10 % | Mønster for krypterede kundehemmeligheder serverside findes (Slack-/Entra-hemmeligheder). Dalux-nøglen er ikke oprettet. | 1 d (inden for B-05) |
| B-07 | Konfigurerbar synkroniseringsfrekvens | Bør | 0 % | Ingen synk. pg_cron + konfiguration pr. kunde er standardmønster (Entra-synk hvert 15. min). | 1 d (inden for B-05) |
| B-08 | Datatyper og retning defineret pr. objekt i integrationsbilag | Skal | 0 % | Dokumentation; skrives efter B-05-design. | 1 d — Afklares |
| B-09 | Fejl logges, kan aflæses og gensendes uden datatab/dubletter | Skal | 5 % | Intet for Dalux. Mønstre findes: importkørsler, beskedlog med gensend, Logs-fremviser. | 3–4 d — outbox/kø med idempotensnøgler, fejlliste med "gensend" |
| B-10 | Nøgler og hemmeligheder kun serverside | Skal | 80 % | Arkitekturen opfylder det: browseren har kun den offentlige anon-nøgle; hemmeligheder ligger i edge-secrets, Postgres Vault og krypterede kundehemmeligheder. | 0,5 d (Dalux-nøglen i samme mønster) |

## C. Dataflow fra booking til afregning

| ID | Krav | Prio | Status | Vurdering | Estimat |
|-|---|-|--|----------|---|
| C-01 | Automatisk fakturakladde: lokale × antal dage × pris | Skal | 10 % *(2026-09-11)* | **Ikke længere blokeret.** De to første faktorer fandtes i forvejen (bookingen kender sin ressource og sit tidsrum), og den tredje — prisen — er bygget 2026-09-11 (C-05). Selve kladden mangler: `invoice_drafts` + `invoice_draft_lines`, generering pr. booking og pr. periode, dag-/timeberegning efter ressourcens `time_mode`, og kladdevisning. Modellen skal være **systemuafhængig** — kladden er Operias egen, og e-conomic er én adapter blandt flere (C-02). | 5–6 d |
| C-02 | Overførsel til regnskabssystem + fakturanummer skrives tilbage | Skal | 0 % | Intet; regnskabssystemet er ikke oplyst. | 5–8 d for én API-integration inkl. tilbageskrivning; 1 d for manuel registrering af fakturanummer som første trin — Afklares |
| C-03 | Samlet fakturering af et filtreret udvalg | Skal | 0 % | Afhænger af C-01 + E-01. | 2–3 d — faktureringskørsel, multivalg i rapporten, audit |
| C-04 | Ingen afsluttet booking kan overses | Skal | 15 % | Listen kan vise afholdte bookinger, men kender ikke faktureringsstatus. | 1 d — filter "afsluttet, ikke faktureret", tælleflise på forsiden, evt. ugentlig påmindelse |
| C-05 | Priser pr. ressource og ydelse med tidsafgrænsede takster | Skal | 85 % *(2026-09-11)* | Bygget. `booking_tariffs` bærer takster pr. **ressource**, **tilkøbsydelse** og **kursistniveau** (sidstnævnte er grundlaget for C-07), hver med beløb, enhed, gyldighedsperiode og et frit momskodefelt. **Enheden er data, ikke antagelse** — `dag`, `time`, `kursist`, `kursist pr. dag`, `fast beløb` — så kundens svar på spørgsmål 4, 5 og 6 bliver en indtastning frem for en migration. To takster med samme enhed kan ikke gælde samtidig (exclusion-constraint, samme mekanik som dobbeltbookingsværnet), så prisopslaget har altid ét svar. Skærmen retter ikke en pris: den lukker den gamle takst dagen før og opretter den næste, hvilket ER acceptkriteriet "ændringer påvirker ikke allerede fakturerede bookinger". Fane **Priser** på ressource og ydelse, og en foldbar prisliste pr. niveau i Konfigurér → Booking. Hver ændring i sporet. Migration `20260911180000_booking_tariffs.sql`, fixtures `supabase/tests/booking_tariffs.sql`. Resten af de 15 %: **snapshot ved fakturering** hører til kladden i C-01, og momskoden er fri tekst indtil momsspørgsmålet er afklaret. | 0,5 d (følger med C-01) |
| C-06 | Tilkøb som særskilte fakturalinjer | Skal | 45 % *(2026-09-09)* | Halvdelen er på plads: hver tilkøbsydelse ligger som sin EGEN linje med tekst, antal og enhedspris (A-06) — det er præcis den form, en fakturalinje skal have. Mangler kun, at kladden i C-01 kopierer dem over. | 1 d (efter C-01) |
| C-07 | Beregning pr. kursist, differentieret på niveau | Skal | 0 % | Afhænger af A-05 + C-05. | 2 d — takst pr. niveau, beregning af linjebeløb |
| C-08 | Godkendelsestrin før fakturering | Bør | 0 % | Bevidst udeladt i booking v1. | 2 d — godkend-RPC, status, økonomi-rolle (F-01), UI, audit |
| C-09 | Kreditnota ved afbestilling/nedjustering efter fakturering | Skal | 0 % | Afhænger af C-01/C-02. | 3–4 d — kreditnota med reference, hel eller differens, overførsel |
| C-10 | Ændret deltagerantal slår igennem, sporbart | Skal | 40 % *(2026-09-08)* | Sporbarheden er på plads: en ændring af deltagerantallet skriver før/efter i `booking_events` (A-05). "Slår igennem på fakturagrundlaget" afventer C-01. | 0,5 d (efter C-01) |

## D. Sporbarhed, ændringslog og dokumentation

| ID | Krav | Prio | Status | Vurdering | Estimat |
|-|---|-|--|----------|---|
| D-01 | Automatisk ændringslog med dato, bruger, type og før/efter | Skal | 90 % *(2026-09-10)* | Rækketriggeren `audit_bookings_row` skriver hver oprettelse, ændring, statusskift, fakturering og sletning i `booking_events` (spejlet til `audit_log`) med tidspunkt, bruger og før/efter. Diffen dækker nu **alle** strukturelle felter — også heldag og status, som RPC'en aldrig skrev — og kun de felter der faktisk ændrede sig kommer med, så loggen er læsbar. Et gem uden ændringer giver ingen hændelse længere. Sletning: en booking kan i praksis ikke slettes ud af det blå (fremmednøglen fra hændelserne er 'restrict', og hændelserne kan ikke slettes), og opbevaringspurgen logger sin egen optælling; triggeren har en sletningsgren som bagstopper. Resten af de 10 %: godkendelse (C-08) findes ikke, og fritekst er bevidst holdt ude — se D-04. | 0 d (godkendelse følger med C-08) |
| D-02 | Loggen fanges på databaseniveau, kan ikke omgås | Skal | 100 % *(2026-09-10)* | Opfyldt. Loggen sidder som `after insert or update or delete ... for each row` på `bookings`, og RPC'erne skriver ikke længere selv. En ændring foretaget uden om brugerfladen — rå SQL, service-rolle, migration, edge-funktion — giver nøjagtig samme hændelse som et klik i UI'et; er der ingen indlogget bruger, står handlingen med tom aktør, hvilket i sig selv er oplysningen. Bevist i `supabase/tests/booking_audit_trigger.sql` trin 4. Aktøren vises ved navn — også når det var en DCA-platform-admin, der over for kunden står som organisationen (`audit_actor_names`, 2026-09-11). | 0 |
| D-03 | Logposter kan ikke redigeres/slettes af brugere | Skal | 100 % *(efterprøvet 2026-09-10)* | Opfyldt — men efterprøvningen fandt en revne, der nu er lukket. Beskyttelsen hvilede på tre lag: RLS uden skrivepolitik, tilbagekaldt UPDATE/DELETE, og `block_mutation` på hændelsestabellerne. Rettighederne fra Supabases standard-`grant all` var derimod aldrig trimmet: `authenticated` havde stadig **TRUNCATE** på alle syv logtabeller, INSERT på hændelsestabellerne og fuld DML på de tre beskedlogge. TRUNCATE er den alvorlige — RLS gælder ikke for den, og `block_mutation` er en rækketrigger, som derfor aldrig fyrer. Den kunne ikke nås gennem PostgREST (ingen TRUNCATE-metode), men acceptkriteriet siger "skrivebeskyttet for alle roller". Alt overskydende er nu tilbagekaldt og efterprøvet ved faktisk at sætte rollen og forsøge. Beskedloggene får bevidst ingen immutabilitetstrigger: de opdateres lovligt af bounce-tilbagemeldinger fra e-mailudbyderen. Læseadgangen er samtidig strammet fra tenant-grænsen alene til ansvarsrollerne: `booking_events` kræver manager/booking_manager, `audit_log` en ansvarsrolle. Håndterere kan altså hverken se eller ændre loggen — før kunne de læse hele virksomhedens spor gennem APIet, selv om siden var lukket for dem. | 0 |
| D-04 | Ændringer aflæses med konsekvens for leverance og fakturering | Skal | 70 % *(2026-09-10)* | Kravet er to ting. **Leverancekonsekvensen** er dækket: hver ændring af ressource, tidsrum, deltagerantal, niveau og tilkøbsydelser står med før/efter, og historiksiden (D-05) viser den læsbart med navne i stedet for id'er. **Beløbskonsekvensen** vises i en egen kolonne, men kun for tilkøbsydelser — de er det eneste med en pris på sig i dag (rettet 2026-09-10: `service_updated` manglede prisen, så en antalsændring ikke kunne omsættes til kroner). For lokale, antal dage og kursistniveau står kolonnen tom med "—" frem for 0 kr., fordi "ingen konsekvens" og "kan ikke gøres op endnu" ikke er det samme; den fyldes ud, når takstlisten (C-05) og fakturagrundlaget (C-01) findes. Fritekstfelterne står som "ændret" uden værdier — aftalt afvigelse, se spørgsmål 7. | 0,5 d (beløbskolonnen udvides med C-01/C-05) |
| D-05 | Samlet historik med filtrering på periode, booking og bruger | Skal | 95 % *(2026-09-10)* | Bygget. **Booking → Historik** viser hele ændringsloggen med de tre filtre kravet nævner: periode (fra/til, afgrænset i basen), bruger (vælger over de aktører der optræder) og booking (fritekstsøgning på ressource, formål, medarbejder og booking-id — den, der leder, husker lokalet, ikke et UUID). Dertil kolonnefilter på handlingstype, sortering og sidevisning. Den enkelte booking har sin egen **historik-fane** i detaljepanelet. Ændringer, der er sket uden om brugerfladen, står med "Uden om brugerfladen" som bruger — D-02 gjort synlig. Resten af de 5 %: udtrækket er begrænset til 500 rækker pr. forespørgsel; serverside-paginering, hvis en kunde får brug for mere. | 0,5 d (paginering, når volumen kræver det) |
| D-06 | Historik og rapporter til CSV og PDF | Skal | 60 % *(2026-09-10)* | **Historikken** kan eksporteres i CSV, PDF og **Word** — kravet nævner to formater, det tredje kostede ingenting, fordi renderen fandtes. Udskriften indeholder de filtrerede poster i læsbar form: navne i stedet for id'er, ændringer som "felt: før → efter", et nøgletalsafsnit (antal ændringer, heraf med beløb, tillæg, fradrag, netto) og de anvendte filtre i sidehovedet, så en udskrift dokumenterer sit eget udsnit. Hver eksport logges som `booking.exported`. Mangler: **rapporterne** — kravet siger "historik OG rapporter", og bookingrapporten er E-01/E-03, som ikke findes endnu. | 0,5 d (rapport-eksporten følger med E-03) |
| D-07 | Opbevaringsperiode aftalt og overholdt | Skal | 70 % | Mekanisme findes: opbevaringsvinduer pr. kunde for revisionslog og bookinger, håndhævet natligt og selv auditeret. Værdier er ikke aftalt. Bemærk: booking-hændelser slettes sammen med bookingen; loggens eget vindue skal derfor mindst være lige så langt. | 0,5 d — aftale værdier, ind i DPA-bilag |

## E. Rapportering og afstemning

| ID | Krav | Prio | Status | Vurdering | Estimat |
|-|---|-|--|----------|---|
| E-01 | Rapport med kombinerbare filtre: periode, ressource, afdeling/kunde, bookingstatus, faktureringsstatus | Skal | 20 % | Bookinglisten har kommende/afholdte/annullerede, fritekst og kolonnefiltre. Mangler periode, ressource, afdeling/kunde og faktureringsstatus samt eksport. "Kunde" findes ikke som begreb — bookinger har en medarbejder, ikke en rekvirent/debitor. | 3 d (+ 1 d for kunde/rekvirent-begreb — Afklares) |
| E-02 | Afstemningsrapport booking → fakturanummer | Skal | 0 % | Afhænger af C-02. | 1,5 d |
| E-03 | Rapporter til CSV og PDF | Skal | 20 % | Renderer findes. | 1 d — booking-rapportbyggere |
| E-04 | Oversigt over ikke-fakturerede, afsluttede bookinger | Bør | 15 % | Som C-04. | 0,5 d |

## F. Drift, sikkerhed og support

| ID | Krav | Prio | Status | Vurdering | Estimat |
|-|---|-|--|----------|---|
| F-01 | Rollestyret adgang: booking, drift, økonomi, administration | Skal | 75 % *(2026-09-10)* | Roller pr. bruger (17 roller), sideadgang defineret i kode, og siden 2026-09-10 håndhæves adgangen til loggene også i RÆKKERNE og ikke kun i brugerfladen — en håndterer kan ikke længere hente ændringsloggen gennem API'et. Skellet mellem drift og disposition er skarpt inden for booking: afbestilling, fakturamarkering, eksport og historik er manager/booking_manager, mens en booking_handler opretter og redigerer. Mangler stadig en egentlig økonomi-rolle (godkend/fakturér, C-08) og en rettighedsmatrix til kunden. | 1,5 d |
| F-02 | Browser uden lokal installation | Skal | 100 % | Web-app (SPA) på operia.predictioninstitute.com. | 0 |
| F-03 | GDPR og databehandleraftale | Skal | 70 % | Teknik stærk: tenant-isolation, uforanderlig log, anonymisering, opbevaring, indsigtsudtræk. DPA foreligger som udkast (DCA-DPA-1.0 på Datatilsynets standardbestemmelser), ikke juridisk gennemgået, ikke underskrevet; databeskyttelsesansvarlig ikke navngivet. | 1–2 d DCA-arbejde + ekstern juridisk gennemgang |
| F-04 | Hosting i EU/EØS, dokumenteret | Skal | 80 % | Supabase i AWS eu-north-1 (Stockholm), dokumenteret i underdatabehandlerregister og DPA-bilag C.5. Åbent: region for DCA's egen web/gateway-server; e-mail (Resend) er US-baseret — relevant for A-04. | 0,5 d (+ 1–2 d hvis EU-mailudbyder ønskes) |
| F-05 | Backup og aftalte RPO/RTO | Skal | 30 % | DR-runbook findes (genskabelse fra git). Supabase kører på gratisplan: ingen automatiske databasebackups; daglig backup kræver Pro-plan, point-in-time recovery er tilkøb. Ingen driftsaftale med RPO/RTO. | 0,5 d opsætning (planopgradering er driftsomkostning) + 1 d driftsaftale og gendannelsestest |
| F-06 | SSO via kundens identitetsstyring | Kan | 10 % | Ingen SSO. Entra ID bruges kun til medarbejdersynk. Supabase Auth understøtter Entra/Azure som login-udbyder. | 3–4 d — udbyder, login pr. kundedomæne, kobling til brugere, håndhævelse pr. kunde |
| F-07 | Support inden for aftalt vindue | Skal | 0 % | Ingen support-/driftsaftale. | 0,5–1 d aftaletekst (ikke udvikling) |
| F-08 | Udlevering af data ved ophør i anvendeligt format | Skal | 100 % *(2026-09-11)* | Bygget. **Kunder → Handlinger → Fuldt dataudtræk** danner en ZIP med én CSV pr. tabel, mappelagt efter produkt, plus `manifest.json` (rækketal pr. tabel, så pakken kan kontrolleres for fuldstændighed) og en læsevejledning. Grupperne er kerne + de otte produkter; kernen er slået til på forhånd, fordi de øvrige filer ellers kun rummer id'er. Udvælgelsen er en hvidliste i basen (`company_export_catalog`) — klienten kan ikke navngive en tabel, der ikke står der, og hemmelighedstabellerne står der ikke. Integrationsnøgler i almindelige tabeller maskeres. Kunden kan selv trække sin kopi (manager/data_manager), og hvert udtræk logges som `privacy.full_export` på niveau warning. Migration `20260911120000_company_full_export.sql`, fixtures `supabase/tests/company_full_export.sql`. **Filerne følger med** (tilstandsfotos, underskrifter, aktivbilag, designbilleder) i mappen `filer/`, listet i `filer.csv` med størrelse og status — også de stier, hvis fil ikke længere findes, så en manglende fil er en oplysning og ikke en tavshed. Loftet er 150 MB pr. pakke, fordi ZIP'en bygges i browserens hukommelse; rammes det, står resten som `skipped_budget`. Ikke med: `imports`-bucket'en (rå HR-filer, slettes efter 30 dage, indholdet står allerede i `employees`) og `feedback` (DCA-intern). Migration `20260911150000_company_export_files.sql`. | 0 d |

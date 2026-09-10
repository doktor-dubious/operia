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

**Estimater** er arbejdsdage for én udvikler i denne kodebase (migration + RPC'er + web-UI + i18n
da/en + dokumentation + review). Afklaringsrunder med kunden, ekstern jura og leverandøromkostninger
er ikke medregnet. "Afklares" = kan ikke prissættes endeligt, før kunden har svaret.

## Samlet billede

| Afsnit | Krav | Gennemsnitlig status | Estimat til 100 % |
|---|---|---|---|
| A. Booking og ressourcestyring | 7 | 84 % | ≈ 1 d |
| B. Integration til Dalux/FM | 10 | 13 % | ≈ 34 d (≈ 20 d blokeret på Dalux-adgang) |
| C. Dataflow booking → afregning | 10 | 11 % | ≈ 27 d (≈ 7 d blokeret på valg af regnskabssystem) |
| D. Sporbarhed og ændringslog | 7 | 53 % | ≈ 8 d |
| E. Rapportering og afstemning | 4 | 14 % | ≈ 7 d |
| F. Drift, sikkerhed og support | 8 | 49 % | ≈ 13 d (heraf ≈ 4 d aftaletekst, ikke udvikling) |
| **I alt** | **46** | **34 %** | **≈ 90 d** — ≈ 62 d kan startes nu, ≈ 28 d afventer kunden |

Fordeling: 3 opfyldt (≥ 90 %), 13 delvist (25–89 %), 13 påbegyndt (5–24 %), 17 mangler (0 %).

Det bærende fund: **bookingkernen er solid** (intervaller, dobbeltbookingsværn i databasen,
RPC-only-skrivning, uforanderlig hændelseslog, roller, opbevaring, indsigtsudtræk), men **alt der
handler om penge findes ikke** — ingen priser, ingen ydelser, ingen kursister, ingen kladder, ingen
fakturanumre. Kravspecifikationens afsnit 5.1 ("Nuværende flow") beskriver en løsning, der endnu
ikke er bygget, og bør rettes, inden dokumentet sendes til kunden.

## Top-5 at starte på

Rækkefølgen er afhængighedsstyret: hvert punkt låser det næste op.

1. **Udvid bookingen til et fakturagrundlag** — ~~A-05 kursister/niveau~~ og
   ~~A-02 faktureringsstatus~~ (begge bygget 2026-09-08), ~~A-07 afbestillingsårsag~~ og
   ~~A-06 ydelseskatalog + ydelseslinjer~~ (2026-09-09); tilbage står
   **rekvirent/kunde (debitor)** på bookingen, og at
   flytte hændelsesloggen til en rækketrigger med fuld før/efter-diff (D-01/D-02 til 100 %)
   mens skemaet alligevel er åbent. ≈ 2 d.
2. **Bookingrapport med filtre og eksport** — E-01, E-03, E-04, C-04, B-01 (on-demand). Periode,
   ressource, afdeling/kunde, bookingstatus, faktureringsstatus; CSV/PDF via den eksisterende
   rapportrenderer. ≈ 5–6 d. Rapporten er navet, som A-01, A-03, B-01, C-03 og E-02 henviser til.
3. **Prisliste med tidsafgrænsede takster** — C-05 (+ takst pr. kursistniveau som grundlag for
   C-07). Pris pr. ressource og pr. ydelse, enhed dag/time/person, gyldighedsperiode, snapshot ved
   fakturering. ≈ 4 d.
4. **Fakturakladde og godkendelse** — C-01, C-06, C-07, C-10, lås efter fakturering (A-03), C-08
   godkendelsestrin, C-03 samlet kørsel, plus *manuel* registrering af fakturanummer som bro til
   C-02. ≈ 11–12 d. Leverer "faktureringsgevinsten" uden at vente på regnskabsintegrationen.
5. **Historik for booking** — D-05 samlet historik med filtre + historik-fane pr. booking, D-04
   læsbar før/efter med beløbskonsekvens, D-06 eksport. ≈ 5 d. Data findes allerede; det er den
   side, kunden bruger til at få tillid til systemet i en pilot.

Derefter: ~~A-04 bekræftelsesmails~~ (bygget 2026-09-08), B-03 bookingimport, F-01 økonomi-rolle,
F-08 samlet dataudtræk.

## Afklar med kunden nu

Svarene er forudsætning for at prissætte ≈ 28 dage, og de tager tid at få. Send spørgsmålene
samtidig med, at punkt 1–2 bygges.

1. **Regnskabssystem** (C-02): hvilket system, hvilken grænseflade (API/fil), og hvordan kommer
   fakturanummeret tilbage? Fx e-conomic, Dynamics 365 BC, Navision Stat.
2. **Dalux** (B-04..B-09): API-adgang og sandbox; hvilke Dalux-objekter svarer til "booking" og
   "afregningslinje" — Dalux FM er et FM-system, ikke et bookingsystem. Hvad udveksles i dag?
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
7. **Tal til aftalerne**: opbevaringsperiode for loggen (D-07), RPO/RTO (F-05), supportvindue
   (F-07), SSO via Entra ID ønskes? (F-06). Bemærk til D-07: opbevaringspurgen sletter afholdte
   bookinger efter kundens vindue uden hensyn til, om de er fakturerede. Enten skal den aftalte
   periode respektere bogføringslovens 5 år, eller purgen skal undtage fakturerede bookinger —
   ellers forsvinder fakturagrundlaget. Standarden er "gem indtil videre", så ingen er ramt i dag.

## Statuslegende

| Bånd | Betydning |
|---|---|
| Opfyldt (90–100 %) | Acceptkriteriet kan demonstreres i dag |
| Delvist (25–89 %) | Funktionen findes i begrænset form |
| Påbegyndt (5–24 %) | Intet for booking, men platformen har mønstret/infrastrukturen klar |
| Udvikling (0 %) | Findes ikke; leveres som afgrænset modul |

## A. Booking og ressourcestyring

| ID | Krav | Prio | Status | Vurdering | Estimat |
|---|---|---|---|---|---|
| A-01 | Booking over sammenhængende periode | Skal | 90 % | Opfyldt: start/slut med klokkeslæt eller hele dage, kan spænde over flere døgn; vises i liste og kalender; dobbeltbooking blokeres i databasen (`bookings_no_overlap`). Mangler kun, at bookingen også fremgår af *rapportoversigten*, som ikke findes endnu (E-01). | 0 d (dækkes af E-01) |
| A-02 | Statusmodel booket → i brug → afsluttet → faktureret, automatisk | Skal | 75 % *(2026-09-08)* | Bygget. De tre første trin udledes af start/slut og skifter derfor af sig selv — intet cron-job, ingen indtastning. *Faktureret* er lagret (`bookings.invoiced_at`), sat af `set_booking_invoiced` (manager/booking_manager), og låser bookingen mod rettelse og annullering. Trinnet vises samlet i listen (sorterbar + filtrerbar kolonne) og i bookingdetaljen. Bevidst IKKE i `booking_status`-enum'en: den bærer dobbeltbookingsværnet (`where status = 'booked'`), og "annulleret efter fakturering" (C-09) er to kendsgerninger, ikke én. Resten af de 25 %: markeringen sættes i dag ved et klik — den bliver først maskinel, når faktureringskørslen (C-01/C-03) kalder samme RPC. | 0 d (sidste trin følger med C-01/C-03) |
| A-03 | Genåbne og rette frem til fakturering | Skal | 70 % *(2026-09-08)* | Redigering af aktive bookinger findes (ressource, medarbejder, tid, titel), også efter afholdelse (`update_booking`), og **låsen ved fakturering er bygget** — `update_booking` og `cancel_booking` afviser en faktureret booking med `booking_invoiced`. Mangler: åbning fra rapporten, og at rettelser slår igennem på et fakturagrundlag. | 0,5 d (+ afhænger af C-01) |
| A-04 | Bekræftelse ved oprettelse/ændring til rekvirent og modtagere | Bør | 85 % *(2026-09-08)* | Bygget. `dispatch-booking-notifications` læser hændelserne ud af `booking_events` og sender på alle fire kanaler; hver afsendelse logges i `booking_notifications`, fejl vises i Logs, og forbrug tælles med på kundens forbrugsside. Fem beskeder, skabeloner pr. platform og kunde, stilletid, dedup pr. hændelse, tre forsøg. Modtagere: medarbejderen, rekvirenten (`booked_by`, slås op som medarbejder) og en fast kopiadresse; faktureringsbeskeden går kun til fakturerings-postkassen. Resten af de 15 %: "rekvirent" er indtil videre den der oprettede bookingen — en egentlig rekvirent/debitor følger med E-01, og "relevante modtagere" er én adresse, ikke en deltagerliste. | 0 d (udvides med debitor-begrebet i E-01) |
| A-05 | Antal kursister og kursistniveau pr. booking | Skal | 90 % *(2026-09-08)* | Bygget. `bookings.participant_count` + `participant_level_id`, begge valgfri (ikke enhver booking er et kursus), udfyldes ved oprettelse og kan rettes frem til fakturering — låsen fra A-03 gælder også dem. Niveauerne er en tabel pr. kunde (`booking_participant_levels`) og ikke fri tekst, netop fordi C-07 skal hænge en takst på dem; listen vedligeholdes på Konfigurér → Booking. Et deaktiveret niveau kan ikke vælges, men bliver stående på bookinger der har det, og et niveau i brug kan ikke slettes (FK 'restrict'), så fakturagrundlaget ikke tømmes i det stille. Før/efter på begge felter står i hændelsesloggen (dækker C-10's sporbarhed). Resten af de 10 %: "indgår i fakturagrundlaget" kan først demonstreres, når C-01 findes. | 0 d (afsluttes med C-01/C-07) |
| A-06 | Tilkøbsydelser med antal og enhedspris fra ydelsesliste | Skal | 90 % *(2026-09-09)* | Bygget. `booking_services` er kundens vedligeholdte ydelsesliste (navn, beskrivelse, med/uden antal, pris pr. enhed eller samlet beløb, aktiv/inaktiv) på siden Booking → Tilkøbsydelser; `booking_service_lines` er linjerne på bookingen med antal og **prissnapshot**, så en senere prisændring ikke rammer det, nogen allerede har godkendt (C-05). Tilføjes/rettes/fjernes via RPC'er, der gentjekker rettigheder og afviser en faktureret booking. En ydelse i brug kan ikke slettes, kun deaktiveres. Resten af de 10 %: **momskode pr. ydelse** mangler — den afventer momsspørgsmålet (spørgsmål 5), og linjerne bliver først til fakturalinjer med C-06. | 0,5 d (momskode, efter afklaring) |
| A-07 | Afbestilling med tidspunkt, årsag og ansvarlig | Skal | 85 % *(2026-09-09)* | Alle tre led registreres: tidspunkt og ansvarlig stemples af serveren (`cancelled_at`/`cancelled_by`), og årsagen er nu et **påkrævet** felt (`cancellation_reason`) — en valgfri begrundelse ville stå tom i de fleste rækker, og så var kravet kun opfyldt på papiret. Afbestilling kræver manager/booking_manager (`can_cancel_bookings`); en booking_handler ser ikke knappen og afvises også server-side. Handlingen står i `booking_events`/`audit_log`, mens selve fritekst-årsagen bevidst kun bor på bookingen (audit_log er uforanderlig og videresendes til log drains). Årsagen søges af indsigtsudtrækket som pakkernes `removed_reason`. Resten af de 15 %: "udgår af fakturagrundlaget" kan først demonstreres, når C-01 findes — i dag udgår bookingen af dobbeltbookingsværnet og af de aktive lister. | 0 d (afsluttes med C-01) |

## B. Integration til Dalux og Kundens FM-system

| ID | Krav | Prio | Status | Vurdering | Estimat |
|---|---|---|---|---|---|
| B-01 | CSV-eksport af bookinger og afregningsdata fra rapporten | Skal | 10 % | Ingen booking-eksport. CSV-motor (UTF-8 BOM, RFC 4180) og eksportpanel findes for medarbejdere/aktiver/lager. | 2 d (efter E-01; Dalux-kolonnelayout jf. B-04) |
| B-02 | Eksport on-demand og planlagt | Skal | 5 % | On-demand følger af B-01. Planlagt eksport findes ikke for noget modul: CSV dannes i browseren i dag, og der er ingen udgående fil-levering. | 4–6 d — serverside CSV-generator, tidsplan pr. kunde, levering via SFTP-push, e-mail-vedhæftning eller download-link |
| B-03 | Import af bookinger fra CSV med kolonnemapning | Skal | 15 % | Generisk importmotor (upload → tørkørsel → anvend, header-genkendelse via aliasser, konfigurerbar kolonnerækkefølge) findes for aktiver/lager. Bookinger kræver opslag af ressource/medarbejder, tidsparsing, overlap-rapport i tørkørslen og et eksternt id, så gen-import ikke giver dubletter. Egentlig mapnings-UI (kolonne → felt) findes ikke. | 4–5 d (+ 1,5 d for eksplicit mapnings-UI) |
| B-04 | Filformat og mapping dokumenteret og aftalt skriftligt | Skal | 0 % | Ikke påbegyndt; kræver Dalux' importformat fra kunden. | 1–2 d — Afklares |
| B-05 | Direkte to-vejs-integration via Dalux REST-API | Skal | 0 % | Intet. Kræver API-adgang, sandbox og afklaring af hvilke Dalux-objekter der svarer til bookinger og afregningslinjer. | 10–15 d — Afklares (blokeret) |
| B-06 | API-nøgle (X-API-KEY) via rollestyret API-identitet | Skal | 10 % | Mønster for krypterede kundehemmeligheder serverside findes (Slack-/Entra-hemmeligheder). Dalux-nøglen er ikke oprettet. | 1 d (inden for B-05) |
| B-07 | Konfigurerbar synkroniseringsfrekvens | Bør | 0 % | Ingen synk. pg_cron + konfiguration pr. kunde er standardmønster (Entra-synk hvert 15. min). | 1 d (inden for B-05) |
| B-08 | Datatyper og retning defineret pr. objekt i integrationsbilag | Skal | 0 % | Dokumentation; skrives efter B-05-design. | 1 d — Afklares |
| B-09 | Fejl logges, kan aflæses og gensendes uden datatab/dubletter | Skal | 5 % | Intet for Dalux. Mønstre findes: importkørsler, beskedlog med gensend, Logs-fremviser. | 3–4 d — outbox/kø med idempotensnøgler, fejlliste med "gensend" |
| B-10 | Nøgler og hemmeligheder kun serverside | Skal | 80 % | Arkitekturen opfylder det: browseren har kun den offentlige anon-nøgle; hemmeligheder ligger i edge-secrets, Postgres Vault og krypterede kundehemmeligheder. | 0,5 d (Dalux-nøglen i samme mønster) |

## C. Dataflow fra booking til afregning

| ID | Krav | Prio | Status | Vurdering | Estimat |
|---|---|---|---|---|---|
| C-01 | Automatisk fakturakladde: lokale × antal dage × pris | Skal | 0 % | Ingen priser, ingen kladder. | 5–6 d — kladde + linjer, generering pr. booking og pr. periode, dag-/timeberegning efter ressourcens tidsgranularitet, kladdevisning |
| C-02 | Overførsel til regnskabssystem + fakturanummer skrives tilbage | Skal | 0 % | Intet; regnskabssystemet er ikke oplyst. | 5–8 d for én API-integration inkl. tilbageskrivning; 1 d for manuel registrering af fakturanummer som første trin — Afklares |
| C-03 | Samlet fakturering af et filtreret udvalg | Skal | 0 % | Afhænger af C-01 + E-01. | 2–3 d — faktureringskørsel, multivalg i rapporten, audit |
| C-04 | Ingen afsluttet booking kan overses | Skal | 15 % | Listen kan vise afholdte bookinger, men kender ikke faktureringsstatus. | 1 d — filter "afsluttet, ikke faktureret", tælleflise på forsiden, evt. ugentlig påmindelse |
| C-05 | Priser pr. ressource og ydelse med tidsafgrænsede takster | Skal | 0 % | Intet. | 3–4 d — taksttabel med gyldighedsperiode og enhed (dag/time/person), UI på ressource og ydelse, prisopslag ved generering, snapshot på linjer så ændringer ikke rammer fakturerede bookinger |
| C-06 | Tilkøb som særskilte fakturalinjer | Skal | 45 % *(2026-09-09)* | Halvdelen er på plads: hver tilkøbsydelse ligger som sin EGEN linje med tekst, antal og enhedspris (A-06) — det er præcis den form, en fakturalinje skal have. Mangler kun, at kladden i C-01 kopierer dem over. | 1 d (efter C-01) |
| C-07 | Beregning pr. kursist, differentieret på niveau | Skal | 0 % | Afhænger af A-05 + C-05. | 2 d — takst pr. niveau, beregning af linjebeløb |
| C-08 | Godkendelsestrin før fakturering | Bør | 0 % | Bevidst udeladt i booking v1. | 2 d — godkend-RPC, status, økonomi-rolle (F-01), UI, audit |
| C-09 | Kreditnota ved afbestilling/nedjustering efter fakturering | Skal | 0 % | Afhænger af C-01/C-02. | 3–4 d — kreditnota med reference, hel eller differens, overførsel |
| C-10 | Ændret deltagerantal slår igennem, sporbart | Skal | 40 % *(2026-09-08)* | Sporbarheden er på plads: en ændring af deltagerantallet skriver før/efter i `booking_events` (A-05). "Slår igennem på fakturagrundlaget" afventer C-01. | 0,5 d (efter C-01) |

## D. Sporbarhed, ændringslog og dokumentation

| ID | Krav | Prio | Status | Vurdering | Estimat |
|---|---|---|---|---|---|
| D-01 | Automatisk ændringslog med dato, bruger, type og før/efter | Skal | 65 % *(2026-09-08)* | Oprettelse/ændring/annullering logges i `booking_events` (spejlet til `audit_log`) med bruger, tidspunkt og før/efter for ressource, medarbejder og tid — ikke titel/heldag. **Fakturering logges nu også** (`booking.invoiced`, og `booking.invoice_cleared` på advarselsniveau, så en fjernet markering fanges af det ugentlige gennemsyn). Godkendelse (C-08) findes ikke endnu. | 1–1,5 d — fuld før/efter-diff af alle felter, resterende hændelsestyper |
| D-02 | Loggen fanges på databaseniveau, kan ikke omgås | Skal | 75 % | Bookinger kan kun skrives via serverside-RPC'er, som altid logger; klienten kan ikke omgå det. En direkte SQL-skrivning (service-rolle, import) ville dog ikke logges, fordi loggen ikke sidder som rækketrigger. | 0,5–1 d — rækketrigger med diff (løser samtidig D-01) |
| D-03 | Logposter kan ikke redigeres/slettes af brugere | Skal | 100 % | `booking_events` og `audit_log`: UPDATE/DELETE frataget alle roller og blokeret af trigger. | 0 |
| D-04 | Ændringer aflæses med konsekvens for leverance og fakturering | Skal | 25 % | Før/efter gemmes som rå JSON med id'er; ingen læsbar fremstilling og ingen faktureringskonsekvens. | 1,5–2 d — læsbar diff med navne, beløbsdifference når grundlaget ændres |
| D-05 | Samlet historik med filtrering på periode, booking og bruger | Skal | 20 % | Ingen kundevendt historik. Platformens Logs-side (kun DCA) filtrerer på tidsrum/niveau/kategori/handling, ikke bruger eller booking. | 2–3 d — Booking → Historik + historik-fane i bookingdetaljen |
| D-06 | Historik og rapporter til CSV og PDF | Skal | 15 % | PDF/CSV/Word-renderer findes (pakkerapporter). | 1 d (efter D-05) |
| D-07 | Opbevaringsperiode aftalt og overholdt | Skal | 70 % | Mekanisme findes: opbevaringsvinduer pr. kunde for revisionslog og bookinger, håndhævet natligt og selv auditeret. Værdier er ikke aftalt. Bemærk: booking-hændelser slettes sammen med bookingen; loggens eget vindue skal derfor mindst være lige så langt. | 0,5 d — aftale værdier, ind i DPA-bilag |

## E. Rapportering og afstemning

| ID | Krav | Prio | Status | Vurdering | Estimat |
|---|---|---|---|---|---|
| E-01 | Rapport med kombinerbare filtre: periode, ressource, afdeling/kunde, bookingstatus, faktureringsstatus | Skal | 20 % | Bookinglisten har kommende/afholdte/annullerede, fritekst og kolonnefiltre. Mangler periode, ressource, afdeling/kunde og faktureringsstatus samt eksport. "Kunde" findes ikke som begreb — bookinger har en medarbejder, ikke en rekvirent/debitor. | 3 d (+ 1 d for kunde/rekvirent-begreb — Afklares) |
| E-02 | Afstemningsrapport booking → fakturanummer | Skal | 0 % | Afhænger af C-02. | 1,5 d |
| E-03 | Rapporter til CSV og PDF | Skal | 20 % | Renderer findes. | 1 d — booking-rapportbyggere |
| E-04 | Oversigt over ikke-fakturerede, afsluttede bookinger | Bør | 15 % | Som C-04. | 0,5 d |

## F. Drift, sikkerhed og support

| ID | Krav | Prio | Status | Vurdering | Estimat |
|---|---|---|---|---|---|
| F-01 | Rollestyret adgang: booking, drift, økonomi, administration | Skal | 70 % *(2026-09-09)* | Roller pr. bruger (15 roller, heraf `booking_manager` og `booking_handler`), sideadgang defineret i kode. Skellet mellem drift og disposition er skærpet inden for booking: afbestilling og fakturamarkering er manager/booking_manager, mens en booking_handler kun opretter og redigerer. Mangler stadig en egentlig økonomi-rolle (godkend/fakturér, C-08) og en rettighedsmatrix til kunden. | 1,5 d |
| F-02 | Browser uden lokal installation | Skal | 100 % | Web-app (SPA) på operia.predictioninstitute.com. | 0 |
| F-03 | GDPR og databehandleraftale | Skal | 70 % | Teknik stærk: tenant-isolation, uforanderlig log, anonymisering, opbevaring, indsigtsudtræk. DPA foreligger som udkast (DCA-DPA-1.0 på Datatilsynets standardbestemmelser), ikke juridisk gennemgået, ikke underskrevet; databeskyttelsesansvarlig ikke navngivet. | 1–2 d DCA-arbejde + ekstern juridisk gennemgang |
| F-04 | Hosting i EU/EØS, dokumenteret | Skal | 80 % | Supabase i AWS eu-north-1 (Stockholm), dokumenteret i underdatabehandlerregister og DPA-bilag C.5. Åbent: region for DCA's egen web/gateway-server; e-mail (Resend) er US-baseret — relevant for A-04. | 0,5 d (+ 1–2 d hvis EU-mailudbyder ønskes) |
| F-05 | Backup og aftalte RPO/RTO | Skal | 30 % | DR-runbook findes (genskabelse fra git). Supabase kører på gratisplan: ingen automatiske databasebackups; daglig backup kræver Pro-plan, point-in-time recovery er tilkøb. Ingen driftsaftale med RPO/RTO. | 0,5 d opsætning (planopgradering er driftsomkostning) + 1 d driftsaftale og gendannelsestest |
| F-06 | SSO via kundens identitetsstyring | Kan | 10 % | Ingen SSO. Entra ID bruges kun til medarbejdersynk. Supabase Auth understøtter Entra/Azure som login-udbyder. | 3–4 d — udbyder, login pr. kundedomæne, kobling til brugere, håndhævelse pr. kunde |
| F-07 | Support inden for aftalt vindue | Skal | 0 % | Ingen support-/driftsaftale. | 0,5–1 d aftaletekst (ikke udvikling) |
| F-08 | Udlevering af data ved ophør i anvendeligt format | Skal | 30 % | CSV-eksport af medarbejdere/aktiver/lager og indsigtsudtræk pr. person findes. Intet samlet kundeudtræk, ingen bookingeksport. | 3 d — samlet udtræk af alle kundens tabeller + filer, DCA-udløst, auditeret |

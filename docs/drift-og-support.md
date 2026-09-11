# Drift- og supportaftale — Operia (udkast, DCA-DRIFT-1.0)

*Udkast 2026-09-13 til EVU-kravene F-04 (hosting), F-05 (backup, RPO/RTO) og F-07 (support).
Tal markeret **[DCA afgør]** er forretningsbeslutninger, ikke tekniske kendsgerninger — de skal
sættes af DCA, før dokumentet sendes til kunden. Alt andet er, hvad systemet faktisk gør i dag.*

## 1. Hosting (F-04)

| Komponent | Leverandør | Region | Status |
|---|---|---|---|
| Database, Auth, Storage, Edge Functions | Supabase (AWS) | **EU — `eu-north-1`, Stockholm** | Dokumenteret; SCC'er i Supabases DPA |
| Web-app (statisk) og import-gateway (SFTP/e-mail) | DCA's egen server (`operia.predictioninstitute.com`, `ftp.predictioninstitute.com`) | **[DCA afgør] — region skal bekræftes og skrives i underdatabehandlerregistret (åbent punkt 2)** | Ikke bekræftet |
| Udgående e-mail | Brevo (FR) *eller* Resend/AhaSend | **EU, hvis Brevo eller AhaSend er valgt** (Operia → Integrationer → E-mail); Resend er US | Valgbart siden 2026-09-08 |
| SMS | GatewayAPI (DK) | EU | Dokumenteret |
| Slack/Teams-beskeder | Salesforce (Slack) | US (DPF) | Kun hvis kunden slår kanalen til |

Det fulde register med overførselsgrundlag pr. modtager: `docs/gdpr/subprocessors.md`. For en
ren EU-konfiguration: samme dokument §5 (Brevo som mailudbyder, Slack/Teams fravalgt).

## 2. Backup og gendannelse (F-05)

**Hvad der gendannes fra git alene** (ingen backup nødvendig): hele skemaet, alle funktioner,
politikker, cron-jobs, skabeloner og platformsindstillingernes standarder — `docs/disaster-recovery.md`
beskriver genopbygning af et tomt projekt trin for trin.

**Hvad der kræver en databackup**: kundens data — bookinger, medarbejdere, pakker, fakturakladder,
revisionslog — og filerne i Storage (fotos, underskrifter, eksporter).

| Emne | I dag | Aftalt niveau |
|---|---|---|
| Databasebackup | Supabase **gratisplan: ingen automatisk backup** | **[DCA afgør]** Pro-plan giver daglig backup (7 dages opbevaring); PITR-tilkøb giver gendannelse til et vilkårligt sekund inden for **[7/14/28] dage** |
| Storage-backup | Ingen ud over Supabases egen replikering | Følger planen |
| **RPO** (maks. datatab) | Ubegrænset (ingen backup) | **[DCA afgør]** — daglig backup: 24 timer; PITR: 2 minutter |
| **RTO** (maks. nedetid ved gendannelse) | Ukendt — aldrig testet | **[DCA afgør]** — realistisk: 4 timer med runbook + backup; skal bekræftes af en gendannelsestest |
| Gendannelsestest | Aldrig udført | **[DCA afgør]** — anbefalet: én gang før go-live, derefter årligt; resultatet noteres i §5 |

Gendannelsestesten består af: (1) opret et nyt Supabase-projekt, (2) kør runbook'en, (3) indlæs
seneste backup, (4) log ind som en kundebruger og åbn rapporten, (5) notér forløbet tid = målt RTO.

## 3. Support (F-07)

| Emne | Aftalt niveau |
|---|---|
| Supportvindue | **[DCA afgør]** — fx hverdage 08:00–16:00 dansk tid |
| Kanaler | E-mail til **[DCA afgør]**; feedback-knappen i Operia (øverst til højre) skriver direkte i DCA's kø |
| Reaktionstid, kritisk (systemet er nede eller data er forkerte) | **[DCA afgør]** — fx 4 timer inden for vinduet |
| Reaktionstid, øvrigt | **[DCA afgør]** — fx næste arbejdsdag |
| Planlagt vedligehold | Varsles **[DCA afgør]** arbejdsdage før; udføres uden for vinduet |
| Kontaktperson hos kunden | Manager-rollen i Operia; navngives i bilag |

## 4. Hvad kunden selv kan (uden support)

Alt under Konfigurér: brugere og roller, ressourcer, priser, momskoder, notifikationer,
opbevaringsperioder, integrationer (Dalux, regnskab, e-mail), planlagt eksport, fuldt dataudtræk
(Kunder → Handlinger — også kundens egen manager kan tage sin kopi).

## 5. Log over gendannelsestests

| Dato | Udført af | Backup fra | Målt RTO | Resultat |
|---|---|---|---|---|
| — | — | — | — | Ingen udført endnu |

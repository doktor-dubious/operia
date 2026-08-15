# Bilag til databehandleraftale — Operia

**Udkast · version `DCA-DPA-1.0` · 14. august 2026**

Bilag til *Standardkontraktsbestemmelser* (Datatilsynet, januar 2020) mellem:

| | |
|---|---|
| **Den dataansvarlige** | *[Kundens juridiske navn], CVR [nr.], [adresse]* |
| **Databehandleren** | *DCA Logic, CVR [nr.], [adresse]* |

> **Udkast.** Teksten er skrevet ud fra systemet som det faktisk er bygget pr.
> 14. august 2026 (se `../ropa.md`, `../subprocessors.md`, `../toms.md`).
> Den skal gennemgås juridisk før første underskrift, og pladsholdere i
> *kursiv* skal udfyldes.

---

# Bilag A — Oplysninger om behandlingen

## A.1 Formålet med databehandlerens behandling af personoplysninger på vegne af den dataansvarlige

Databehandleren stiller **Operia** til rådighed som en flerbruger-SaaS-løsning til
intern forsendelseshåndtering (track & trace) og de tilkøbte produktmoduler, som
den dataansvarlige har aktiveret. Formålene er:

1. **Modtagelse og sporing af forsendelser** — at registrere en pakke ved
   ankomst, knytte den til den rette modtager og føre en sammenhængende,
   dokumenterbar kæde over hvem der har haft den, hvornår og hvor, indtil den er
   udleveret, afvist, returneret eller annulleret.
2. **Udlevering og kvittering** — at dokumentere den faktiske overdragelse
   (underskrift, NFC-kort, fuldmagt eller aflevering på aftalt sted).
3. **Underretning af modtagere** — at sende driftsbeskeder og påmindelser pr.
   e-mail og SMS.
4. **Vedligeholdelse af medarbejderkartoteket** — at holde modtagerkartoteket
   ajour via import fra den dataansvarliges HR-system eller synkronisering fra
   den dataansvarliges eget Microsoft Entra ID.
5. **AI-aflæsning af forsendelseslabels** — hvis den dataansvarlige har slået
   funktionen til: at læse teksten på et labelfoto, så felterne ikke skal tastes.
6. **Ruteplanlægning** — hvis aktiveret: at beregne kørselsruter ud fra adresser.
7. **Aktiv- og udlånsstyring** — hvis aktiveret: at registrere udlån, retur,
   flytning og dokumentation af aktiver.
8. **Revisionsspor og logning** — at føre et uforanderligt spor over handlinger
   i systemet, herunder valgfri videresendelse til den dataansvarliges eget
   logsystem.
9. **Drift, support og fejlretning** af løsningen.

Behandling til databehandlerens egne formål finder ikke sted. Personoplysninger
overladt af den dataansvarlige bruges **ikke** til produktudvikling, statistik
på tværs af kunder, træning af AI-modeller eller markedsføring.

## A.2 Databehandlerens behandling af personoplysninger på vegne af den dataansvarlige drejer sig primært om (karakteren af behandlingen)

Indsamling, registrering, organisering, systematisering, opbevaring, tilpasning,
ændring, søgning, brug, visning, sammenstilling, videregivelse til de i Bilag B
nævnte underdatabehandlere, begrænsning, anonymisering og sletning — udført ved
automatisk databehandling i databehandlerens SaaS-løsning samt manuelt af
databehandlerens personale i forbindelse med support og drift.

## A.3 Behandlingen omfatter følgende typer af personoplysninger om de registrerede

Alene **almindelige personoplysninger** (databeskyttelsesforordningens art. 6):

- **Medarbejderstamdata:** navn, initialer, medarbejdernummer, e-mailadresse,
  telefonnummer, afdeling, NFC-/adgangskort-id, eksternt id fra kildesystemet,
  status (aktiv/deaktiveret/anonymiseret).
- **Forsendelsesoplysninger:** modtagers identitet, afsender (fritekst,
  kan være en privatperson), stregkode/forsendelsesnummer, forsendelsestype,
  privat/erhverv, placering, tidsstempler.
- **Udleveringsdokumentation:** underskriftsbillede, navn på den der har
  afhentet (fritekst, kan være tredjemand), noter, afvisningsårsag, årsag ved
  ændret modtager eller annullering.
- **Billeder:** tilstandsfotos af forsendelser (kan vise personer),
  aktivdokumentation, samt **midlertidigt** et labelfoto ved AI-aflæsning.
- **Kontaktoplysninger til beskeder:** e-mailadresse og mobilnummer på modtagere
  af notifikationer.
- **Adresser** til ruteplanlægning, herunder geokodede koordinater.
- **Låntagerdata** ved aktivudlån: navn, adresse, e-mail, telefon.
- **Brugerkonti:** e-mail, adgangskode (hashet), roller, tidspunkt for seneste
  login, offentlig nøgle ved adgangsnøgle (passkey).
- **Logdata:** aktørens bruger-id, medarbejdernummer, tidsstempler, IP-adresse
  og protokol ved filoverførsel, maskerede modtageradresser.

**Ikke omfattet:** særlige kategorier af personoplysninger (art. 9) og
oplysninger om strafbare forhold (art. 10). Løsningen indsamler, overfører eller
opbevarer **ingen biometriske data** — biometrisk oplåsning sker udelukkende på
brugerens egen enhed, og løsningen modtager alene resultatet "godkendt".
Et underskriftsbillede er dokumentation for en overdragelse, ikke en biometrisk
skabelon, og bruges ikke til identifikation.

## A.4 Behandlingen omfatter følgende kategorier af registrerede

- Den dataansvarliges medarbejdere som **modtagere** af forsendelser.
- Den dataansvarliges medarbejdere som **brugere** af løsningen
  (pakkeansvarlige, managers, øvrige rollehavere).
- **Eksterne afsendere, kurerer og leverandører**, der er navngivet på en
  forsendelse.
- **Tredjemand nævnt i fritekst**, typisk den der afhenter en forsendelse på
  andres vegne.
- **Låntagere** af aktiver, herunder eksterne.
- **Modtagere af adresser** i en planlagt rute.

## A.5 Behandlingen kan påbegyndes efter Bestemmelsernes ikrafttræden og har følgende varighed

Behandlingen løber, så længe hovedaftalen om brug af Operia er i kraft.
Ved ophør sletter eller tilbageleverer databehandleren oplysningerne efter
Bilag C.4. Bestemmelserne er gældende, indtil behandlingen er ophørt og
oplysningerne slettet.

---

# Bilag B — Underdatabehandlere

## B.1 Godkendte underdatabehandlere

Ved Bestemmelsernes ikrafttræden har den dataansvarlige godkendt følgende
underdatabehandlere. Den fuldstændige, løbende ajourførte fortegnelse med
databehandlingens omfang og overførselsgrundlag findes i
[`../subprocessors.md`](../subprocessors.md).

| Underdatabehandler | Behandling | Lokalitet | Overførselsgrundlag | Anvendes ved |
|---|---|---|---|---|
| Supabase, Inc. (US) | Hosting: database, autentifikation, fillager, serverfunktioner | **EU — AWS eu-north-1 (Stockholm)** | EU-Kommissionens standardkontraktbestemmelser (SCC) | Altid — platformen |
| Amazon Web Services | Underliggende infrastruktur | EU *(DCA's egen gateway/webserver: region bekræftes)* | SCC + DPF | Altid |
| Plus Five Five, Inc. ("Resend", US) | Afsendelse af e-mail: invitationer, adgangskode, notifikationer | US | **EU-U.S. Data Privacy Framework** + SCC | Altid (kontomails), e-mailnotifikationer |
| ActiveCampaign, LLC ("Postmark", US) | Modtagelse af HR-filer sendt pr. e-mail | US | **EU-U.S. Data Privacy Framework** | Kun ved e-mail-baseret dataoverførsel |
| GatewayAPI A/S (DK) | Afsendelse af SMS | **EU (Danmark)** | Ingen overførsel til tredjeland | Kun ved SMS-notifikationer |
| Mistral AI SAS (FR) | AI-aflæsning af labelfoto | **EU (Frankrig)** | Ingen overførsel til tredjeland | Kun ved AI-labellæsning med Mistral valgt |
| Anthropic PBC (US) | AI-aflæsning af labelfoto | US | SCC (databehandleraftale med udbyderen) | Kun ved AI-labellæsning med Anthropic valgt |
| Google LLC (US) | (a) AI-aflæsning af labelfoto; (b) geokodning, ruteberegning og kortvisning | US | **EU-U.S. Data Privacy Framework** + SCC | (a) AI med Google valgt; (b) ruteplanlægning med Google som kortudbyder |
| HeiGIT gGmbH (DE) — OpenRouteService | Geokodning og ruteberegning | **EU (Tyskland)** | Ingen overførsel til tredjeland | Ruteplanlægning (standardvalg) |

**Funktionsafhængighed.** Kun de underdatabehandlere, der er markeret "Altid",
modtager oplysninger uanset opsætning. De øvrige anvendes udelukkende, når den
dataansvarlige selv har slået den pågældende funktion til. Er AI-labellæsning
ikke aktiveret, sker der ingen overførsel til Mistral, Anthropic eller Google AI.

**Ikke underdatabehandlere:** Microsoft (ved synkronisering fra Entra ID læser
Operia fra den dataansvarliges *eget* Microsoft-abonnement på dennes vegne), og
det logsystem den dataansvarlige eventuelt selv peger en log-drain mod
(destinationen vælges og instrueres af den dataansvarlige).

## B.2 Varsel ved ændring af underdatabehandlere

Den dataansvarlige giver hermed **generel godkendelse** til brug af
underdatabehandlere, jf. Bestemmelsernes punkt om underdatabehandlere.

Databehandleren underretter skriftligt den dataansvarliges
databeskyttelseskontakt **mindst 30 dage** før en ny underdatabehandler tages i
brug, eller en eksisterende udskiftes. Den dataansvarlige kan inden for
varselsperioden gøre indsigelse på saglige databeskyttelsesmæssige grunde. Kan
indsigelsen ikke imødekommes, kan den dataansvarlige opsige den berørte funktion
eller aftalen uden vederlag for den resterende periode.

Underretning sendes til den kontakt, den dataansvarlige har registreret under
**Konfigurér → Databeskyttelse** i Operia. Det påhviler den dataansvarlige at
holde kontakten ajour.

---

# Bilag C — Instruks vedrørende behandling af personoplysninger

## C.1 Behandlingens genstand/instruks

Databehandleren må alene behandle personoplysninger efter dokumenteret instruks
fra den dataansvarlige. Instruksen udgøres af:

1. Denne aftale med bilag, herunder formålene i Bilag A.1.
2. **Den dataansvarliges egen opsætning i løsningen** — hvilke produkter og
   funktioner der er aktiveret, notifikationsindstillinger, opbevaringsperioder,
   log-drains, valg af kortudbyder og valg af AI-udbyder og -model.
   Opsætningsændringer, der har betydning for behandlingen, registreres i
   løsningens revisionsspor med bruger og tidspunkt.
3. **Særskilt bekræftelse ved AI-labellæsning.** Funktionen kan ikke aktiveres,
   før den dataansvarlige i løsningen har bekræftet en oplysningstekst, der
   navngiver den valgte udbyder, udbyderens land, hvad der sendes, og hvad der
   ikke gemmes. Bekræftelsen er den dataansvarliges dokumenterede instruks om
   overførslen, den registreres med bruger, tidspunkt og tekstversion, og den
   bortfalder automatisk, hvis udbyderen skiftes.
4. Skriftlige instrukser i øvrigt, afgivet til databehandlerens
   databeskyttelseskontakt.

Databehandleren underretter omgående den dataansvarlige, hvis en instruks efter
databehandlerens opfattelse strider mod databeskyttelsesreglerne.

## C.2 Behandlingssikkerhed

De tekniske og organisatoriske foranstaltninger er beskrevet i
[`../toms.md`](../toms.md), som **udgør en integreret del af dette bilag i den
udgave, der er gældende på underskriftstidspunktet** — herunder dokumentets §12
om kendte begrænsninger. Hovedelementerne er:

- **Adskillelse af kunder:** hver kunde er isoleret på databaseniveau
  (row level security på hver tabel), ikke i applikationskoden alene.
  Klienter (browser og håndterminal) behandles som utroværdige; enhver
  privilegeret handling genverificeres på serveren.
- **Adgangsstyring:** personlige brugerkonti, rollestyret adgang, hashede
  adgangskoder, rotation af sessionstokens, hastighedsbegrænsning på
  loginforsøg, og konfigurerbare tilladte loginmetoder pr. virksomhed.
- **Kryptering:** TLS på al transport, herunder til underdatabehandlere; SFTP
  (SSH) ved filoverførsel; kryptering af data og backup i hvile.
- **Pseudonymisering og anonymisering:** medarbejdere slettes ikke, men
  anonymiseres serverside via én central funktion; låntagerkontakt og
  beskedmodtagere ryddes automatisk ved retur af et aktiv.
- **Dataminimering i logs:** revisionssporet indeholder medarbejdernumre og
  maskerede modtageradresser frem for navne og adresser; AI-aflæsninger logges
  alene med udbyder, model og udfald — aldrig billedet eller det aflæste indhold.
- **Uforanderligt revisionsspor:** hændelseslog og forsendelseshistorik kan
  hverken ændres eller slettes af nogen bruger; logning sker serverside og kan
  ikke springes over eller forfalskes.
- **Fortrolighed om adgangsnøgler:** API-nøgler og hemmeligheder findes kun i
  serverens miljø, aldrig i klienten eller i kildekoden.
- **Sikkerhed ved filmodtagelse:** afsenderkontrol (SPF/DKIM/DMARC) og
  hvidliste ved e-mail; adgangsstyret og adskilt område pr. kunde ved SFTP;
  alle logins og filoperationer logges med IP.
- **Tilgængelighed:** administreret database med backup og
  point-in-time-gendannelse; dokumenteret genetableringsprocedure.

Foranstaltningerne er fastlagt ud fra, at behandlingen ikke omfatter særlige
kategorier af personoplysninger, men omfatter oplysninger om ansattes
færden og handlinger i arbejdstiden, hvilket stiller krav om et uforanderligt og
minimeret revisionsspor.

## C.3 Bistand til den dataansvarlige

Databehandleren bistår, i det omfang det er muligt og under hensyn til
behandlingens karakter, med:

| Bistand | Sådan sker det | Frist |
|---|---|---|
| **Indsigt (art. 15)** | Den dataansvarlige laver selv et samlet udtræk pr. person under **Konfigurér → Persondata → Indsigtsanmodning** — både for medarbejdere og, via fritekst-søgning, for personer uden medarbejderrække (fuldmagtsafhentere, private afsendere). Udtrækket leveres som JSON og angiver hvor tilhørende billedfiler ligger; selve billederne udleveres efter anmodning | Selvbetjening; billedfiler *[10] arbejdsdage* |
| **Berigtigelse (art. 16)** | Den dataansvarlige retter selv stamdata i løsningen eller via næste import | Straks, selvbetjening |
| **Sletning (art. 17)** | Den dataansvarlige anonymiserer selv en medarbejder i løsningen. Anonymisering bevarer forsendelseshistorikken, men fjerner personhenførbarheden — se C.4 | Straks, selvbetjening |
| **Begrænsning og indsigelse (art. 18, 21)** | Deaktivering af bruger/medarbejder og af notifikationer; øvrige tilfælde efter skriftlig anmodning | *[10] arbejdsdage* |
| **Dataportabilitet (art. 20)** | Eksport af stamdata i maskinlæsbart format | Selvbetjening |
| **Brud på persondatasikkerheden (art. 33–34)** | Underretning til den dataansvarliges registrerede sikkerhedskontakt med de oplysninger, databehandleren råder over, jf. Bilag D | **inden 24 timer** efter databehandleren er blevet opmærksom på bruddet |
| **Konsekvensanalyse og forudgående høring (art. 35–36)** | Beskrivelse af behandling, kategorier, modtagere og sikkerhed stilles til rådighed (Bilag A + C.2 + `../ropa.md`) | Efter anmodning |

**Begrænsning oplyst i god tro:** fritekstfelter (navn på den der har afhentet,
noter og årsagsfelter) og forsendelseshistorikkens hændelseslog omfattes ikke af
den automatiske anonymisering, fordi de udgør dokumentationen for den enkelte
overdragelse. En anmodning, der berører sådanne felter, håndteres manuelt efter
konkret vurdering sammen med den dataansvarlige.

## C.4 Opbevaringsperiode/sletterutine

Opbevaringsperioden fastlægges af **den dataansvarlige** og sættes i løsningen under
**Konfigurér → Persondata → Opbevaring** i otte kategorier (pakker, fotos og
underskrifter, beskedlog, revisionslog, import, udlånshistorik, fratrådte
medarbejdere, ruteplaner). Er en kategori ikke sat, følger den databehandlerens
standard; er ingen af delene sat, opbevares data indtil videre. Oprydningen kører
automatisk hver nat og skrives i revisionsloggen. Ved Bestemmelsernes ikrafttræden
gælder:

| Datakategori | Opbevaring |
|---|---|
| Medarbejderstamdata | Så længe medarbejderen findes i kundens kartotek. Medarbejdere, der forsvinder fra en import, deaktiveres — de slettes ikke, fordi forsendelseshistorikken henviser til dem. En fratrådt medarbejder anonymiseres automatisk, når dennes sidste forsendelse er afsluttet |
| Forsendelser og forsendelseshistorik | Følger aftalens løbetid. **Forsendelseshistorikken (hændelsesloggen) slettes ikke automatisk** — den er dokumentationen for kæden af overdragelser; en sletteanmodning imødekommes ved at anonymisere den person, hændelsen henviser til, ikke ved at omskrive historikken |
| Tilstandsfotos og underskrifter | Slettes automatisk, når de ikke længere hører til en forsendelse, og efter en opbevaringsperiode, der kun gælder **afsluttede** forsendelser |
| HR-importfiler | Kildefilen slettes efter vellykket import; alle filer fjernes senest efter 30 dage |
| Revisionslog | Efter den opbevaringsperiode, den dataansvarlige aftaler med databehandleren; loggen kan ikke redigeres, kun slettes efter alder |
| Labelfoto ved AI-aflæsning | Gemmes ikke — hverken hos databehandleren eller på håndterminalen efter aflæsningen |
| Backup | Udløber efter driftsplatformens backup-cyklus. En sletning i driftssystemet slår igennem i backup, når den pågældende backup udløber |

Den fuldstændige oversigt — kategori, hvad den dækker, hvad der sker ved udløb, og
hvad der bevidst står uden for — er [`../retention-schedule.md`](../retention-schedule.md).

**Ved ophør af Bestemmelserne** sletter databehandleren personoplysningerne
efter den dataansvarliges valg om enten tilbagelevering eller sletning:

1. Den dataansvarlige meddeler valget senest ved ophør.
2. Ved tilbagelevering leveres et samlet udtræk i maskinlæsbart format inden
   *[30]* dage.
3. Databehandleren sletter herefter data, filer, brugerkonti og opsætning inden
   *[90]* dage og bekræfter sletningen skriftligt.
4. Kopier i backup udløber efter backup-cyklussen og genskabes ikke.

## C.5 Lokalitet for behandling

Behandlingen sker på følgende lokaliteter:

| Behandling | Lokalitet |
|---|---|
| Database, fillager, autentifikation, serverfunktioner | **EU — Stockholm, Sverige (AWS eu-north-1)** |
| Filmodtagelses-gateway og webserver | EU *(bekræftes, jf. `../subprocessors.md` §4)* |
| Underdatabehandleres behandling | Som anført i Bilag B |
| Databehandlerens support og administration | Danmark |

Behandling på andre lokaliteter kræver den dataansvarliges forudgående
skriftlige godkendelse.

## C.6 Instruks vedrørende overførsel af personoplysninger til tredjelande

Den dataansvarlige instruerer databehandleren i at overføre personoplysninger
til tredjelande i det omfang, det følger af de funktioner, den dataansvarlige
selv har aktiveret, og alene til de modtagere og på det grundlag, der fremgår af
Bilag B:

- **E-mail** (Resend, US) — EU-U.S. Data Privacy Framework.
- **Modtagelse af HR-filer pr. e-mail** (Postmark/ActiveCampaign, US) —
  EU-U.S. Data Privacy Framework.
- **AI-labellæsning** med Anthropic (US, SCC) eller Google (US, DPF/SCC) —
  kræver desuden den dataansvarliges særskilte bekræftelse, jf. C.1, punkt 3.
- **Ruteplanlægning og kortvisning** med Google som valgt udbyder (US, DPF/SCC).

Overførsel til andre tredjelande eller på andet grundlag må ikke finde sted uden
den dataansvarliges forudgående skriftlige instruks.

**Konfiguration uden overførsel til tredjeland.** Den dataansvarlige kan vælge
Mistral (FR) til AI-aflæsning eller slå funktionen fra, OpenRouteService (DE)
til ruteplanlægning og SMS frem for e-mail. Databehandleren oplyser i god tro,
at **e-mailafsendelse i dag ikke kan gennemføres inden for EU/EØS**, og at en
fuldstændig EU-konfiguration derfor forudsætter, at der ikke sendes e-mail fra
løsningen.

## C.7 Procedurer for den dataansvarliges revisioner, herunder inspektioner, med behandlingen af personoplysninger, som er overladt til databehandleren

1. Databehandleren stiller **årligt**, og ellers efter anmodning, følgende til
   rådighed: den ajourførte fortegnelse over underdatabehandlere, beskrivelsen
   af tekniske og organisatoriske foranstaltninger, samt en rapport over
   opbevaringsindstillinger, brugere og roller for den dataansvarliges eget
   miljø.
2. Den dataansvarlige kan derudover **én gang årligt** gennemføre en fysisk
   eller virtuel inspektion med mindst *[30]* dages skriftligt varsel.
   Inspektionen må ikke kompromittere andre kunders data.
3. Ekstraordinære inspektioner kan gennemføres ved mistanke om brud eller på
   krav fra en tilsynsmyndighed, uden varselsfrist.
4. Den dataansvarlige afholder egne omkostninger. Databehandlerens medgåede tid
   ud over det årlige dokumentationsmateriale afregnes til gældende timepris.
5. Den dataansvarlige kan til enhver tid selv trække sit eget revisionsspor ud
   af løsningen eller få det leveret løbende til eget logsystem (log-drain).

## C.8 Procedurer for revisioner, herunder inspektioner, med behandling af personoplysninger, som er overladt til underdatabehandlere

1. Databehandleren fører tilsyn med underdatabehandlerne og indhenter deres
   databehandleraftaler, sikkerhedsdokumentation og, hvor sådanne foreligger,
   uafhængige erklæringer og certificeringer (fx ISO 27001, SOC 2).
2. Tilsynet gennemføres mindst **årligt** og desuden, hver gang en
   underdatabehandler tilføjes eller udskiftes, eller der indtræder forhold, som
   giver anledning til fornyet vurdering.
3. Dokumentation for tilsynet udleveres til den dataansvarlige efter anmodning.
4. Den dataansvarlige kan ikke selv gennemføre inspektion hos en
   underdatabehandler; databehandleren indhenter i stedet den nødvendige
   dokumentation på den dataansvarliges vegne.

---

# Bilag D — Parternes regulering af andre forhold

## D.1 Kontaktpersoner

| Rolle | Hos den dataansvarlige | Hos databehandleren |
|---|---|---|
| Databeskyttelse | Registreres af kunden under Konfigurér → Databeskyttelse | *[navn, e-mail]* |
| Sikkerhed/brud (helst døgnet rundt) | Registreres af kunden samme sted | *[navn, e-mail, telefon]* |

Parterne holder kontaktoplysningerne ajour. Underretning efter C.3 og B.2 anses
for afgivet, når den er sendt til den senest registrerede kontakt.

## D.2 Underretning ved brud på persondatasikkerheden

Databehandleren underretter den dataansvarliges sikkerhedskontakt **inden 24
timer** efter at være blevet opmærksom på et brud, med de oplysninger
databehandleren på det tidspunkt råder over, og supplerer løbende. Fristen er
kortere end forordningens "uden unødig forsinkelse" og er valgt, fordi den
dataansvarliges egen frist over for Datatilsynet er 72 timer og løber fra
databehandlerens underretning. Proceduren er beskrevet i
`../incident-response.md`.

## D.3 Fortrolighed

Databehandlerens personale og underleverandører er underlagt tavshedspligt om
personoplysninger, også efter ansættelsens eller samarbejdets ophør.

## D.4 Bilagenes version

Disse bilag har version **`DCA-DPA-1.0`**. Den underskrevne version registreres
i løsningen på den dataansvarliges virksomhed. Væsentlige ændringer forelægges
den dataansvarlige, før de træder i kraft.

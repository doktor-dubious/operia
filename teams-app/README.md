# Operia — Teams-app

> **Status: parkeret 2026-09-04.** Hvor vi nåede til, hvad der blokerer, og hvad der
> allerede er bevist står i [`docs/notification-channels.md`](../docs/notification-channels.md) §4.
> Læs den før arbejdet genoptages — flere spørgsmål er allerede afklaret empirisk.

Apppakken der gør det muligt at sende pakkebeskeder som **direkte besked i Microsoft
Teams**. Pakken er tre filer: `manifest.json`, `color.png` (192×192) og `outline.png`
(32×32, kun hvid + gennemsigtig — Teams afviser andre farver i outline-ikonet).

```
cd teams-app && zip -j operia-teams.zip manifest.json color.png outline.png
```

Zip'en skal have filerne i RODEN (deraf `-j`), ellers afvises den ved upload.

## Hvorfor en app overhovedet

Teams tillader ikke at et vilkårligt system skriver til en bruger. En besked skal komme
fra en **bot**, botten skal være **installeret for modtageren**, og installationen kræver
en app. Derfor:

```
Azure Bot (vores, SINGLE tenant)     ← identiteten beskederne sendes som
   + Entra-appregistrering sat til MULTITENANT  ← det der gør kryds-tenant muligt
        │
        ├── Teams-apppakke (denne mappe) ← det kunden installerer
        │
        └── Installation pr. bruger ← det der gør proaktiv besked mulig
```

### Hvorfor single-tenant bot + multitenant appregistrering

Microsoft **udfasede oprettelse af multi-tenant bots pr. 31. juli 2025**. Nye
Azure Bot-ressourcer kan kun være *Single Tenant* eller *User-Assigned Managed
Identity* — "Multi Tenant" findes ikke længere i portalen.

Kryds-tenant løses derfor et andet sted: selve **botten er single-tenant**, mens den
tilknyttede **Entra-appregistrering sættes til "Accounts in any organizational
directory (Multitenant)"**. Begge skal ligge i vores egen hjemme-tenant.

### Konsekvens for udrulning — læs denne før tidsplanen lægges

| Vej | Virker til | Bemærkning |
|---|---|---|
| **AppSource / Teams Store** | produktion | Microsofts anbefalede og eneste pålidelige vej. Microsoft håndterer installation, samtykke og service principal i kundens tenant. Kræver indsendelse og godkendelse — uger på Microsofts kalender, ikke vores. |
| **Sideload af .zip** | pilot/test | Kundens admin uploader zip'en. Kræver at kunden tillader custom app upload, og at der gives administrator-samtykke: `https://login.microsoftonline.com/common/adminconsent?client_id={app_id}`. **Proaktive beskeder kan fejle med 401**, fordi botten kun henter tokens fra sin hjemme-tenant. Duer til én pilotkunde, ikke til drift. |

Det betyder at butiks-indsendelsen ikke er en valgfri sidste finish, men den
egentlige leveringsvej. Start den tidligt.

Modsat Slack er der altså ikke ét OAuth-klik. Til gengæld forlader beskederne aldrig
kundens egen tenant, og Teams bliver derfor **ikke** en ny databehandler
(jf. `docs/gdpr/subprocessors.md`).

## `isNotificationOnly: true`

Botten kan kun sende, ikke samtale. Det er både sandt (der er ingen dialoglogik) og
nyttigt: Teams skjuler skrivefeltet, så en medarbejder ikke sidder og skriver et svar
ingen læser. Det er også det mindst indgribende svar at give i en sikkerhedsgennemgang.

Scope er `personal` alene — appen kan ikke tilføjes til kanaler eller møder.

## Før pakken kan bruges

1. `botId` skal erstattes med **Microsoft App ID** fra Azure Bot-registreringen
   (se afsnittet i svaret fra opsætningen). Feltet står bevidst som
   `REPLACE_WITH_MICROSOFT_APP_ID`, så en ufærdig pakke fejler synligt i stedet for at
   blive uploadet med en forkert id.
2. `privacyUrl` og `termsOfUseUrl` skal pege på sider der findes. Teams tjekker ikke
   indholdet ved sideload, men gør det ved udgivelse i butikken.
3. `id` (0e9c9c12-…) er appens egen GUID og må **ikke** ændres efter første udrulning —
   Teams bruger den til at genkende opdateringer af den samme app frem for en ny app.

## Versionering

`version` skal øges ved hver ændring af manifestet, ellers afviser Teams uploaden som
en dublet. `id` bliver.

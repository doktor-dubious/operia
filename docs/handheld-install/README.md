# Installation af Operia håndterminal-app

Appen installeres ved at scanne QR-koden herunder (`operia-handheld-qr.png`) med
enhedens kamera. QR-koden peger på en **stabil URL** — når vi udgiver en ny version,
peger samme kode automatisk på den nyeste APK.

**URL:** https://rjlxmdfmktucunxehtqz.supabase.co/storage/v1/object/public/app-dist/operia-handheld.apk

## Sådan installeres appen (på enheden)

1. Scan QR-koden med kameraet (eller åbn URL'en i browseren) — APK'en downloades.
   Chrome advarer "Filen kan være skadelig" ved alle APK-downloads — vælg
   **Download alligevel**.
2. Åbn den downloadede fil fra notifikationen eller *Downloads*.
3. Første gang: Android spørger om tilladelse til at installere fra denne kilde
   ("Installer ukendte apps") — tillad det for browseren, og fortsæt.
4. Tryk **Installér**. Appen hedder *Operia*.

**Opdatering:** scan samme QR-kode igen og installér oven på den eksisterende app.
Det virker, fordi alle versioner er signeret med samme DCA Logic-nøgle.

## Udgivelse af ny version (internt)

```bash
# Bump versionCode/versionName i android/app/build.gradle.kts, derefter:
./android/publish-apk.sh
```

Kræver signeringsnøglen på byggemaskinen: `~/Android/keystores/operia-release.jks`
(+ `operia-keystore.properties` sammesteds, symlinket til `android/keystore.properties`).
**Nøglen ligger bevidst uden for git og skal backes op** — mistes den, kan
eksisterende installationer ikke opdateres uden af-/geninstallation.

Bucketen `app-dist` er offentligt læsbar (APK'en indeholder kun den offentlige
anon key); kun platform-admins kan uploade (migration `20260722093233_app_dist_bucket`).

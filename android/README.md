# Operia — Android håndterminal-app

Kotlin + Jetpack Compose + [supabase-kt](https://github.com/supabase-community/supabase-kt).
Målgruppe: pakkehåndterings-personale med håndterminal (stregkodescanner, kamera, NFC/MIFARE).

## Kom i gang

1. Åbn **denne mappe** (`android/`) i Android Studio (Ladybug eller nyere).
2. Studio genererer selv Gradle-wrapperen og henter dependencies ved første sync.
   (Wrapperen er ikke committet endnu — commit `gradle/wrapper/` + `gradlew*` efter første sync.)
3. Kør på emulator eller enhed (min. Android 8.0 / API 26).

Supabase-URL og anon key ligger i `app/build.gradle.kts` som `buildConfigField`s —
anon-nøglen er offentlig by design; adgangskontrol er RLS på serveren.

## Struktur

- `app/src/main/java/com/dcalogic/operia/` — `MainActivity.kt` (Compose-entry),
  `data/Supabase.kt` (delt klient: Auth, Postgrest, Storage, Functions)
- `app/src/main/res/values/strings.xml` — **dansk er default** (spec: dansk først);
  engelsk i `values-en/`. Per-tenant overrides (`app_labels`) slås op i runtime ovenpå.

## Planlagt hardware-integration (spec)

- Stregkodescanning: kamera + vendor-SDK'er (Zebra DataWedge m.fl.)
- NFC/MIFARE-kort til identitet ved udlevering
- Underskrift på skærm (findes i prototypen `prototype/Operia_Mobile`)

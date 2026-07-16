# Operia — Android håndterminal-app

Kotlin + Jetpack Compose + [supabase-kt](https://github.com/supabase-community/supabase-kt).
Målgruppe: pakkehåndterings-personale med håndterminal (stregkodescanner, kamera, NFC/MIFARE).
Taler med **samme** Supabase-projekt som admin-webappen (`rjlxmdfmktucunxehtqz`) —
pakker modtaget på terminalen dukker op i admin og omvendt.

## Funktioner (svarer til prototypens scope, mod det rigtige skema)

- **Log ind** — Supabase Auth (email/adgangskode); session persisteres på enheden.
  Kræver en `app_users`-række (virksomhed) og rollen `parcel_handler`/`manager` (RLS).
- **Hjem** — fliser gated på `company_features` (`hh_receive`, `hh_handout`, `hh_search`,
  `hh_route`, `hh_stock`; er ingen `hh_*` opsat vises alt). Branding (navn/farve) fra
  `product_appearance` for produktet `parcels`, cachet lokalt.
- **Modtag pakker** (Flow 1) — vælg afdeling/medarbejder (+ evt. placering), scan flere
  pakker, gem som batch → `parcels` (status sættes af `parcels_guard`; `parcel_events`
  logges af triggere). **Offline-kø**: uden net gemmes lokalt og synkroniseres fra
  hjemmeskærmens banner.
- **Udlever pakke** — scan → find pakken, kvittér med navn, note og **underskrift på
  skærm** (feature `signature`; PNG uploades til den private `signatures`-bucket,
  `<company_id>/<parcel_id>-<ts>.png`). En `unassigned` pakke skal først tildeles
  modtager (state-maskinen tillader ikke unassigned → delivered).
- **Søg** — chain-of-custody-opslag på stregkode med status, modtager og udleveret-til.
- **Ruteplan** — ruter fra admin (`routes`); åbner Google Maps-navigation for hele ruten
  eller ét stop.
- **Lager** (produkt `lager`) — scan SKU, vareind/vareud/optælling på `inventory_items.quantity`
  (RLS: `inventory_items_update_handler` giver parcel_handler UPDATE).

Scan-feltet opfører sig som prototypen: hardware-scannere sender tastetryk + Enter;
feltet auto-sender også efter 250 ms pause. ⌨-knappen slår soft-keyboard til.

## Kom i gang

```bash
# Byg (JDK 17 + Android SDK; se ~/Android/env.sh på dev-maskinen)
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Eller åbn mappen i Android Studio (Ladybug+) og kør på emulator/enhed (min. API 26).

Supabase-URL og anon key ligger i `app/build.gradle.kts` som `buildConfigField`s —
anon-nøglen er offentlig by design; adgangskontrol er RLS på serveren.

Testbruger (DCA Demo A/S, rolle parcel_handler): `terminal@dcademo.dk` —
adgangskoden ligger uden for git.

## Struktur

- `app/src/main/java/com/dcalogic/operia/`
  - `MainActivity.kt` — NavHost + session-gate (login/splash/app)
  - `AppViewModel.kt` — session + bootstrap (app_user, stamdata, features, branding)
  - `data/Supabase.kt` — delt klient (Auth, Postgrest, Storage, Functions)
  - `data/Models.kt` — @Serializable DTO'er mod det rigtige skema
  - `data/Repository.kt` — alle databasekald
  - `data/LocalStore.kt` — offline-kø (modtagelser) + branding-cache
  - `ui/` — tema (mørkt, prototypens palette), fælles komponenter (ScanBox,
    LookupPicker, toast), `SignatureDialog` (Compose-canvas → PNG)
  - `ui/screens/` — Login, Home, Receive, Handout, Search, Route, Stock
- `app/src/main/res/values/strings.xml` — **dansk er default** (spec: dansk først);
  engelsk i `values-en/`. Per-tenant overrides (`product_text_override`) slås op i
  runtime ovenpå — aldrig ind i filerne her.

## Planlagt hardware-integration (spec)

- Stregkodescanning via kamera + vendor-SDK'er (Zebra DataWedge m.fl.) — i dag
  virker alle scannere der sender tastetryk (keyboard wedge)
- NFC/MIFARE-kort til identitet ved udlevering (feature `nfc_handover`)
- Tilstandsfoto ved modtagelse (feature `photo`, bucket `parcel-photos`)

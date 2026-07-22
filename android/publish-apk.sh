#!/usr/bin/env bash
# Byg og udgiv håndterminal-APK'en til Supabase Storage (app-dist-bucketen).
# URL'en er stabil, så den trykte QR-kode (docs/handheld-install/) bliver ved
# med at virke — kunden scanner samme kode og får altid nyeste version.
#
# Kræver: ~/Android (JDK/SDK), android/keystore.properties (symlink til
# ~/Android/keystores/operia-keystore.properties) og SUPABASE_SERVICE_ROLE_KEY
# i det gitignorede rod-.env (Dashboard → Settings → API — må ALDRIG i git).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="$REPO_ROOT/android/app/build/outputs/apk/release/app-release.apk"
UPLOAD_URL="https://rjlxmdfmktucunxehtqz.supabase.co/storage/v1/object/app-dist/operia-handheld.apk"
PUBLIC_URL="https://rjlxmdfmktucunxehtqz.supabase.co/storage/v1/object/public/app-dist/operia-handheld.apk"

# Upload sker med curl og ikke `supabase storage cp`: CLI'en (2.109.1) sætter
# ikke x-upsert og har intet overwrite-flag, så genudgivelse over den
# eksisterende fil fejler med 409 Duplicate (og `storage rm` sletter intet).
if [ -f "$REPO_ROOT/.env" ]; then
  set -a; source "$REPO_ROOT/.env"; set +a
fi
if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "FEJL: SUPABASE_SERVICE_ROLE_KEY er ikke sat — tilføj den til rod-.env" >&2
  echo "(Supabase Dashboard → Settings → API → service_role. .env er gitignoret.)" >&2
  exit 1
fi

if [ ! -f "$REPO_ROOT/android/keystore.properties" ]; then
  echo "FEJL: android/keystore.properties mangler — release ville blive usigneret." >&2
  echo "Opret symlink: ln -s ~/Android/keystores/operia-keystore.properties android/keystore.properties" >&2
  exit 1
fi

source "$HOME/Android/env.sh"

echo "==> Bygger signeret release-APK..."
(cd "$REPO_ROOT/android" && ./gradlew assembleRelease -q)

echo "==> Verificerer signatur..."
BT="$(ls "$HOME/Android/Sdk/build-tools/" | sort -V | tail -1)"
"$HOME/Android/Sdk/build-tools/$BT/apksigner" verify "$APK"

echo "==> Uploader til Supabase Storage..."
# x-upsert erstatter den eksisterende fil på samme URL; cache-control holdes
# kort (60 s), så "samme QR = nyeste version" også holder lige efter en udgivelse.
curl -fsS -X POST "$UPLOAD_URL" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/vnd.android.package-archive" \
  -H "x-upsert: true" \
  -H "cache-control: max-age=60" \
  --data-binary "@$APK" >/dev/null

echo "==> Udgivet: $PUBLIC_URL"
# Sanity-tjek: den offentlige URL skal svare 200 med præcis den størrelse, vi
# lige har uploadet — ellers serveres en gammel version stadig.
EXPECTED_SIZE="$(stat -c%s "$APK")"
HEADERS="$(curl -sI "$PUBLIC_URL")"
echo "$HEADERS" | grep -iE "^HTTP|content-length|cache-control"
if ! echo "$HEADERS" | grep -qi "content-length: $EXPECTED_SIZE"; then
  echo "ADVARSEL: content-length matcher ikke den uploadede APK ($EXPECTED_SIZE bytes)." >&2
  exit 1
fi

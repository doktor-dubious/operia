#!/usr/bin/env bash
# Build and deploy the Operia web app to https://operia.predictioninstitute.com
# (served by Apache from /web/operia.predictioninstitute.com/html — vhost set up 2026-07-22).
set -euo pipefail
cd "$(dirname "$0")"

npm run build

# Værn: Vite læser .env.local i ALLE modes. Den 5. sep 2026 blev sitet bygget
# med en .env.local der pegede på den lokale stack, så produktionen talte med
# 127.0.0.1:54321 og ingen kunne logge ind. Bygget skal indeholde det rigtige
# projekt-URL og ingen localhost-backend, ellers deployer vi ikke.
# Værdien kan stå med eller uden anførselstegn i .env — Vite accepterer begge,
# og grep -F nedenfor må ikke lede efter selve anførselstegnene i bundtet.
expected_url="$(grep -m1 '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
if [ -z "$expected_url" ]; then
  echo "FEJL: VITE_SUPABASE_URL mangler i web/.env" >&2; exit 1
fi
if ! grep -rqF "$expected_url" dist/assets/; then
  echo "FEJL: bygget peger ikke på $expected_url — tjek for en web/.env.local" >&2; exit 1
fi
if grep -rqE '127\.0\.0\.1:54321|localhost:54321' dist/assets/; then
  echo "FEJL: bygget indeholder en lokal Supabase-adresse — deploy afbrudt" >&2; exit 1
fi

sudo rsync -a --delete dist/ /web/operia.predictioninstitute.com/html/
sudo chown -R www-data:www-data /web/operia.predictioninstitute.com/html

echo "Deployed to https://operia.predictioninstitute.com"

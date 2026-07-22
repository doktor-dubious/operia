#!/usr/bin/env bash
# Build and deploy the Operia web app to https://operia.predictioninstitute.com
# (served by Apache from /web/operia.predictioninstitute.com/html — vhost set up 2026-07-22).
set -euo pipefail
cd "$(dirname "$0")"

npm run build
sudo rsync -a --delete dist/ /web/operia.predictioninstitute.com/html/
sudo chown -R www-data:www-data /web/operia.predictioninstitute.com/html

echo "Deployed to https://operia.predictioninstitute.com"

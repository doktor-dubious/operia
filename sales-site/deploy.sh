#!/usr/bin/env bash
# Deploy the Operia sales site (static, no build step) to
# https://operia-info.predictioninstitute.com — Apache vhost set up 2026-08-22.
set -euo pipefail
cd "$(dirname "$0")"

# Eneste rsync til docroot — setup-vhost.sh kalder også dette script, så
# exclude-listen (server-scripts og README må aldrig publiceres) findes ét sted.
sudo mkdir -p /web/operia-info.predictioninstitute.com/html
sudo rsync -a --delete --exclude deploy.sh --exclude setup-vhost.sh --exclude README.md ./ /web/operia-info.predictioninstitute.com/html/
sudo chown -R www-data:www-data /web/operia-info.predictioninstitute.com/html

echo "Deployed to https://operia-info.predictioninstitute.com"

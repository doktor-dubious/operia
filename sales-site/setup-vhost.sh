#!/usr/bin/env bash
# One-time server setup for https://operia-info.predictioninstitute.com
# (sales material / besparelsesberegner — static site, no build step).
# Run with: sudo bash sales-site/setup-vhost.sh
# Afterwards, redeploy content with sales-site/deploy.sh.
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN=operia-info.predictioninstitute.com
ROOT=/web/$DOMAIN

mkdir -p "$ROOT/html" "$ROOT/logs"

cat > /etc/apache2/sites-available/$DOMAIN.conf <<'CONF'
# ---------------------------------------------------------------------------------------------------
# operia-info.predictioninstitute.com — Operia sales material (static, no SPA)

<VirtualHost *:80>
    ServerAdmin  rune@predictioninstitute.com
    ServerName   operia-info.predictioninstitute.com

    DocumentRoot /web/operia-info.predictioninstitute.com/html

    <Directory /web/operia-info.predictioninstitute.com/html>
        Options -Indexes
        AllowOverride None
        Require all granted
    </Directory>

    <Files "index.html">
        Header set Cache-Control "no-cache"
    </Files>

    # Security headers
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"

    LogLevel warn
    ErrorLog  /web/operia-info.predictioninstitute.com/logs/error.log
    CustomLog /web/operia-info.predictioninstitute.com/logs/access.log combined
</VirtualHost>
CONF

a2ensite $DOMAIN >/dev/null
apachectl configtest
systemctl reload apache2

# First deploy of the content — deploy.sh owns the rsync (and its exclude
# list), so the two scripts cannot drift apart.
bash deploy.sh

# TLS — certbot rewrites the vhost with the redirect + -le-ssl.conf,
# same pattern as operia.predictioninstitute.com. Requires DNS to have
# propagated to Let's Encrypt's resolvers; rerun this script if it fails.
certbot --apache -d $DOMAIN --non-interactive --agree-tos --redirect \
  -m rune@predictioninstitute.com

echo "Done: https://$DOMAIN"

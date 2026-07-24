#!/usr/bin/env bash
# Deploy-worker for håndterminal-APK'en: overvåger handheld_deploys-tabellen
# (fyldt af "Udgiv ny version"-knappen på Operia → Handheld-design → Handlinger),
# kører publish-apk.sh og skriver status + log tilbage. Kører på byggemaskinen
# som systemd-user-service (operia-deploy-worker.service) — webappen kan ikke
# selv bygge, da JDK + signeringsnøglen kun findes her.
#
# Kræver SUPABASE_SERVICE_ROLE_KEY i det gitignorede rod-.env; nøglen bliver
# på denne maskine og går aldrig i git eller ud til klienter.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REST="https://rjlxmdfmktucunxehtqz.supabase.co/rest/v1/handheld_deploys"
POLL_SECONDS=15

if [ -f "$REPO_ROOT/.env" ]; then
  set -a; source "$REPO_ROOT/.env"; set +a
fi
if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "FEJL: SUPABASE_SERVICE_ROLE_KEY er ikke sat (rod-.env)." >&2
  exit 1
fi

auth=(-H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY")

now() { date -u +%FT%TZ; }

# PATCH med JSON-krop; kroppen bygges i python for sikker escaping af loggen.
patch_row() { # $1 = filter-query, $2..$n = key=value-par (value er rå tekst)
  local filter="$1"; shift
  python3 - "$@" <<'EOF' | curl -fsS -X PATCH "$REST?$filter" "${auth[@]}" \
      -H "Content-Type: application/json" -H "Prefer: return=minimal" --data-binary @- \
    || echo "ADVARSEL: kunne ikke opdatere $filter" >&2
import json, sys
body = {}
for arg in sys.argv[1:]:
    k, v = arg.split("=", 1)
    body[k] = v
print(json.dumps(body))
EOF
}

echo "Deploy-worker startet ($(now)) — poller hver ${POLL_SECONDS}s."

# Genopretning efter crash: workeren bygger synkront, så ved opstart er enhver
# 'running'-række efterladt af en tidligere kørsel (genstart/strømsvigt midt i
# bygningen). Uden oprydning ville unik-indekset (én aktiv række) blokere alle
# fremtidige udgivelser for altid — webappen kan ikke selv rydde op (UPDATE er
# frataget authenticated).
patch_row "status=eq.running" "status=failed" "finished_at=$(now)" \
  "log=Afbrudt: deploy-workeren genstartede, mens bygningen kørte. Start en ny udgivelse."

while true; do
  # Gør kø-rækken til "running" og få den retur i samme kald (atomisk claim —
  # unik-indekset garanterer højst én aktiv række).
  claimed=$(curl -fsS -X PATCH "$REST?status=eq.queued" "${auth[@]}" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" \
    --data-binary "{\"status\":\"running\",\"started_at\":\"$(now)\"}" || echo '[]')
  id=$(python3 -c 'import json,sys; rows=json.loads(sys.argv[1] or "[]"); print(rows[0]["id"] if rows else "")' "$claimed")

  if [ -n "$id" ]; then
    echo "==> Udgivelse $id claimet, kører publish-apk.sh..."
    log_file=$(mktemp)
    if "$REPO_ROOT/android/publish-apk.sh" >"$log_file" 2>&1; then
      status=success
    else
      status=failed
    fi
    echo "==> Udgivelse $id: $status"
    # Kun halen af loggen gemmes — det er fejlene i slutningen, man skal bruge.
    patch_row "id=eq.$id" "status=$status" "finished_at=$(now)" "log=$(tail -c 8000 "$log_file")"
    rm -f "$log_file"
  fi

  sleep "$POLL_SECONDS"
done

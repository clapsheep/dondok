#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
ENV_FILE="${1:-$REPOSITORY_DIR/.env.example}"

command -v docker >/dev/null 2>&1 || {
  printf 'ERROR: docker is required\n' >&2
  exit 1
}
command -v jq >/dev/null 2>&1 || {
  printf 'ERROR: jq is required\n' >&2
  exit 1
}
[[ -f "$ENV_FILE" ]] || {
  printf 'ERROR: environment file does not exist: %s\n' "$ENV_FILE" >&2
  exit 1
}

COMPOSE=(
  docker compose
  --env-file "$ENV_FILE"
  -f "$REPOSITORY_DIR/compose.yaml"
  -f "$REPOSITORY_DIR/compose.prod.yaml"
)
"${COMPOSE[@]}" config --quiet
CONFIG_JSON="$("${COMPOSE[@]}" config --format json)"

jq -e '
  (.services.db.networks | has("app")) and
  (.services.backend.networks | has("app")) and
  (.services.frontend.networks | has("app")) and
  ((.services | has("caddy")) | not) and
  ((.services.db.ports // []) | length == 1) and
  (.services.db.ports[0].host_ip == "127.0.0.1") and
  (.services.db.ports[0].published == "15432") and
  (.services.db.ports[0].target == 5432) and
  (.services.db.ports[0].protocol == "tcp") and
  ((.services.backend.ports // []) | length == 0) and
  ((.services.frontend.ports // []) | length == 1) and
  (.services.frontend.ports[0].host_ip == "127.0.0.1") and
  (.services.frontend.ports[0].published == "18080") and
  (.services.frontend.ports[0].target == 8080) and
  (.services.frontend.ports[0].protocol == "tcp") and
  ([.services[] | .logging.options["max-size"]] | all(. == "10m")) and
  ([.services[] | .logging.options["max-file"]] | all(. == "5")) and
  ([.services[] | .mem_limit] | all(. > 0)) and
  ([.services[] | .cpus] | all(. > 0))
' >/dev/null <<<"$CONFIG_JSON"

LAN_CONFIG_JSON="$({
  DONDOK_DB_BIND_HOST=192.168.100.7 \
  DONDOK_DB_HOST_PORT=15432 \
    "${COMPOSE[@]}" config --format json
})"

jq -e '
  ((.services.db.ports // []) | length == 1) and
  (.services.db.ports[0].host_ip == "192.168.100.7") and
  (.services.db.ports[0].published == "15432") and
  (.services.db.ports[0].target == 5432) and
  (.services.db.ports[0].protocol == "tcp") and
  ([.services.db.ports[].host_ip] | all(. != "0.0.0.0" and . != "::" and . != ""))
' >/dev/null <<<"$LAN_CONFIG_JSON"

/bin/bash -n \
  "$REPOSITORY_DIR/infra/deploy-production.sh" \
  "$REPOSITORY_DIR/infra/duckdns-update.sh" \
  "$REPOSITORY_DIR/infra/install-duckdns-updater.sh" \
  "$REPOSITORY_DIR/infra/postgres-backup.sh" \
  "$REPOSITORY_DIR/infra/postgres-restore-drill.sh"

"$REPOSITORY_DIR/infra/tests/duckdns-update-contract.sh"

python3 - \
  "$REPOSITORY_DIR/infra/launchd/com.dondok.docker-desktop.plist.example" \
  "$REPOSITORY_DIR/infra/launchd/com.dondok.duckdns-update.plist.example" \
  "$REPOSITORY_DIR/infra/launchd/com.dondok.postgres-backup.plist.example" <<'PYTHON'
import plistlib
import sys

for path in sys.argv[1:]:
    with open(path, "rb") as plist:
        plistlib.load(plist)
PYTHON

printf 'Production Compose contracts passed\n'

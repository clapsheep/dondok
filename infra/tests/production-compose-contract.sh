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
  (.services.frontend.networks | has("app") and has("edge")) and
  (.services.caddy.networks | has("edge")) and
  ((.services.db.ports // []) | length == 0) and
  ((.services.backend.ports // []) | length == 0) and
  ((.services.frontend.ports // []) | length == 0) and
  ([.services.caddy.ports[].target] | sort == [80, 443, 443]) and
  ([.services.caddy.ports[].protocol] | sort == ["tcp", "tcp", "udp"]) and
  ([.services[] | .logging.options["max-size"]] | all(. == "10m")) and
  ([.services[] | .logging.options["max-file"]] | all(. == "5")) and
  ([.services[] | .mem_limit] | all(. > 0)) and
  ([.services[] | .cpus] | all(. > 0))
' >/dev/null <<<"$CONFIG_JSON"

/bin/bash -n \
  "$REPOSITORY_DIR/infra/deploy-production.sh" \
  "$REPOSITORY_DIR/infra/postgres-backup.sh" \
  "$REPOSITORY_DIR/infra/postgres-restore-drill.sh"

python3 - \
  "$REPOSITORY_DIR/infra/launchd/com.dondok.docker-desktop.plist.example" \
  "$REPOSITORY_DIR/infra/launchd/com.dondok.postgres-backup.plist.example" <<'PYTHON'
import plistlib
import sys

for path in sys.argv[1:]:
    with open(path, "rb") as plist:
        plistlib.load(plist)
PYTHON

docker run --rm \
  -e DONDOK_DOMAIN=money.example.com \
  -v "$REPOSITORY_DIR/infra/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.11.4-alpine \
  caddy validate --config /etc/caddy/Caddyfile >/dev/null

printf 'Production Compose contracts passed\n'

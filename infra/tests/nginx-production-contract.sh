#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
IMAGE="${1:-dondok-frontend:local}"
NETWORK="${2:-}"
RUN_ID="nginx-production-contract-$$"
CONTAINER="dondok-$RUN_ID"

[[ -n "$NETWORK" ]] || {
  printf 'Usage: %s [frontend-image] DOCKER_NETWORK\n' "$0" >&2
  exit 1
}
docker image inspect "$IMAGE" >/dev/null
docker network inspect "$NETWORK" >/dev/null

cleanup() {
  if [[ "$(docker inspect -f '{{ index .Config.Labels "com.dondok.run-id" }}' "$CONTAINER" 2>/dev/null || true)" == "$RUN_ID" ]]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

COMMON_MOUNTS=(
  -v "$REPOSITORY_DIR/infra/nginx-rate-limits.conf:/etc/nginx/conf.d/00-rate-limits.conf:ro"
  -v "$REPOSITORY_DIR/infra/nginx-server-security.conf:/etc/nginx/dondok/server-security/production.conf:ro"
)

docker run --rm \
  --network "$NETWORK" \
  --entrypoint nginx \
  "${COMMON_MOUNTS[@]}" \
  "$IMAGE" -t

docker run -d \
  --name "$CONTAINER" \
  --label "com.dondok.run-id=$RUN_ID" \
  --network "$NETWORK" \
  -p 127.0.0.1::8080 \
  "${COMMON_MOUNTS[@]}" \
  "$IMAGE" >/dev/null

HEALTH_STATUS=""
for _ in $(seq 1 20); do
  HEALTH_STATUS="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER")"
  [[ "$HEALTH_STATUS" == healthy ]] && break
  [[ "$HEALTH_STATUS" == unhealthy ]] && {
    printf 'ERROR: production frontend became unhealthy\n' >&2
    exit 1
  }
  sleep 1
done
[[ "$HEALTH_STATUS" == healthy ]] || {
  printf 'ERROR: production frontend healthcheck timed out\n' >&2
  exit 1
}

PORT="$(docker port "$CONTAINER" 8080/tcp | awk -F: 'NR == 1 {print $NF}')"
CODES="$({
  for _ in $(seq 1 20); do
    curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
      "http://127.0.0.1:$PORT/api/auth/login-ids/rate-limit-check/availability"
  done
})"
printf '%s\n' "$CODES" | grep -Fxq 200
printf '%s\n' "$CODES" | grep -Fxq 429

printf 'Production Nginx contracts passed\n'

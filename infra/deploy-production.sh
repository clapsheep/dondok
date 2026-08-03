#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SOURCE_DIR=""
DEPLOY_DIR=""
ENV_FILE=""
BACKUP_DIR=""
STATE_DIR=""
REVISION=""
LOCK_DIR=""
LOCK_ACQUIRED=false
REPOSITORY_URL="https://github.com/clapsheep/dondok.git"

usage() {
  printf '%s\n' \
    'Usage: infra/deploy-production.sh --source-dir PATH --deploy-dir PATH --env-file PATH' \
    '       --backup-dir PATH --state-dir PATH --revision GIT_SHA'
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ "$LOCK_ACQUIRED" == true && -d "$LOCK_DIR" ]]; then
    rm -f -- "$LOCK_DIR/owner.txt"
    rmdir -- "$LOCK_DIR" 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-dir)
      [[ $# -ge 2 ]] || fail '--source-dir requires a value'
      SOURCE_DIR="$2"
      shift 2
      ;;
    --deploy-dir)
      [[ $# -ge 2 ]] || fail '--deploy-dir requires a value'
      DEPLOY_DIR="$2"
      shift 2
      ;;
    --env-file)
      [[ $# -ge 2 ]] || fail '--env-file requires a value'
      ENV_FILE="$2"
      shift 2
      ;;
    --backup-dir)
      [[ $# -ge 2 ]] || fail '--backup-dir requires a value'
      BACKUP_DIR="$2"
      shift 2
      ;;
    --state-dir)
      [[ $# -ge 2 ]] || fail '--state-dir requires a value'
      STATE_DIR="$2"
      shift 2
      ;;
    --revision)
      [[ $# -ge 2 ]] || fail '--revision requires a value'
      REVISION="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

for required_path in SOURCE_DIR DEPLOY_DIR ENV_FILE BACKUP_DIR STATE_DIR; do
  value="${!required_path}"
  [[ -n "$value" ]] || fail "$required_path is required"
  [[ "$value" == /* ]] || fail "$required_path must be an absolute path"
done
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || fail 'revision must be a full lowercase Git SHA'
[[ -d "$SOURCE_DIR/.git" ]] || fail 'source directory must be a Git checkout'
SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd -P)"
[[ "$(git -C "$SOURCE_DIR" rev-parse HEAD)" == "$REVISION" ]] \
  || fail 'source checkout HEAD does not match the requested revision'

file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

require_private_file() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" && -O "$path" ]] || fail "private file is missing, linked, or not owned by this user: $path"
  local mode
  mode="$(file_mode "$path")"
  mode="${mode#0}"
  (( (8#$mode & 077) == 0 )) || fail "private file must not be accessible by group or others: $path"
}

require_private_file "$ENV_FILE"

for private_dir in "$BACKUP_DIR" "$STATE_DIR" "$(dirname "$DEPLOY_DIR")"; do
  if [[ ! -e "$private_dir" ]]; then
    mkdir -p -- "$private_dir"
    chmod 700 "$private_dir"
  fi
  [[ -d "$private_dir" && ! -L "$private_dir" && -O "$private_dir" ]] \
    || fail "private directory is missing, linked, or not owned by this user: $private_dir"
  mode="$(file_mode "$private_dir")"
  mode="${mode#0}"
  (( (8#$mode & 077) == 0 )) || fail "private directory must not be accessible by group or others: $private_dir"
done

LOCK_DIR="$STATE_DIR/deploy.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "another deployment or an uncleared deployment lock exists: $LOCK_DIR"
fi
LOCK_ACQUIRED=true
chmod 700 "$LOCK_DIR"
printf 'pid=%s\nrevision=%s\nstarted_at_utc=%s\n' \
  "$$" "$REVISION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LOCK_DIR/owner.txt"
chmod 600 "$LOCK_DIR/owner.txt"

DOCKER_BIN="$(command -v docker || true)"
[[ -n "$DOCKER_BIN" ]] || fail 'docker CLI is required'
DOCKER_READY=false
for _ in $(seq 1 30); do
  if "$DOCKER_BIN" info >/dev/null 2>&1; then
    DOCKER_READY=true
    break
  fi
  sleep 2
done
[[ "$DOCKER_READY" == true ]] || fail 'Docker daemon did not become ready within 60 seconds'
"$DOCKER_BIN" compose version >/dev/null

export DONDOK_BACKEND_IMAGE="dondok-backend:$REVISION"
export DONDOK_FRONTEND_IMAGE="dondok-frontend:$REVISION"

REVISION_FILE="$STATE_DIR/current-revision"
if [[ -e "$REVISION_FILE" ]]; then
  require_private_file "$REVISION_FILE"
  RECORDED_REVISION="$(sed -n '1p' "$REVISION_FILE")"
  if [[ "$RECORDED_REVISION" == "$REVISION" \
     && -d "$DEPLOY_DIR/.git" \
     && "$(git -C "$DEPLOY_DIR" rev-parse HEAD 2>/dev/null || true)" == "$REVISION" \
     && -z "$(git -C "$DEPLOY_DIR" status --porcelain 2>/dev/null || true)" ]] \
     && "$DOCKER_BIN" image inspect "$DONDOK_BACKEND_IMAGE" >/dev/null 2>&1 \
     && "$DOCKER_BIN" image inspect "$DONDOK_FRONTEND_IMAGE" >/dev/null 2>&1; then
    CURRENT_COMPOSE=(
      "$DOCKER_BIN" compose
      --env-file "$ENV_FILE"
      -f "$DEPLOY_DIR/compose.yaml"
      -f "$DEPLOY_DIR/compose.prod.yaml"
    )
    "${CURRENT_COMPOSE[@]}" config --quiet
    "${CURRENT_COMPOSE[@]}" up -d --no-build --wait --remove-orphans
    printf 'DEPLOY already-current revision=%s\n' "$REVISION"
    exit 0
  fi
fi

SOURCE_COMPOSE=(
  "$DOCKER_BIN" compose
  --env-file "$ENV_FILE"
  -f "$SOURCE_DIR/compose.yaml"
  -f "$SOURCE_DIR/compose.prod.yaml"
)
"${SOURCE_COMPOSE[@]}" config --quiet
"${SOURCE_COMPOSE[@]}" build --pull backend frontend

if [[ ! -e "$DEPLOY_DIR" ]]; then
  git clone --filter=blob:none "$REPOSITORY_URL" "$DEPLOY_DIR"
fi
[[ -d "$DEPLOY_DIR/.git" && ! -L "$DEPLOY_DIR" ]] || fail 'deployment directory must be a non-symlink Git checkout'
DEPLOY_DIR="$(cd "$DEPLOY_DIR" && pwd -P)"
[[ -z "$(git -C "$DEPLOY_DIR" status --porcelain)" ]] || fail 'deployment checkout contains local changes'
[[ "$(git -C "$DEPLOY_DIR" remote get-url origin)" == "$REPOSITORY_URL" ]] \
  || fail 'deployment checkout origin does not match the Dondok repository'

git -C "$DEPLOY_DIR" fetch --prune origin main
git -C "$DEPLOY_DIR" cat-file -e "$REVISION^{commit}"
git -C "$DEPLOY_DIR" merge-base --is-ancestor "$REVISION" origin/main \
  || fail 'requested revision is not reachable from origin/main'

PREVIOUS_REVISION="$(git -C "$DEPLOY_DIR" rev-parse HEAD)"
RUNNING_DB=""
if [[ -f "$DEPLOY_DIR/compose.yaml" && -f "$DEPLOY_DIR/compose.prod.yaml" ]]; then
  PREVIOUS_COMPOSE=(
    "$DOCKER_BIN" compose
    --env-file "$ENV_FILE"
    -f "$DEPLOY_DIR/compose.yaml"
    -f "$DEPLOY_DIR/compose.prod.yaml"
  )
  RUNNING_DB="$("${PREVIOUS_COMPOSE[@]}" ps -q db 2>/dev/null || true)"
fi

if [[ -n "$RUNNING_DB" ]] && [[ "$("$DOCKER_BIN" inspect -f '{{.State.Running}}' "$RUNNING_DB" 2>/dev/null || true)" == true ]]; then
  printf 'BACKUP starting before deployment revision=%s\n' "$REVISION"
  BACKUP_OUTPUT="$(
    "$DEPLOY_DIR/infra/postgres-backup.sh" \
      --env-file "$ENV_FILE" \
      --compose-file "$DEPLOY_DIR/compose.yaml" \
      --compose-file "$DEPLOY_DIR/compose.prod.yaml" \
      --backup-dir "$BACKUP_DIR" \
      --retention-days 30
  )"
  printf '%s\n' "$BACKUP_OUTPUT"
  BACKUP_BUNDLE="$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^BACKUP completed //p' | tail -1)"
  [[ -n "$BACKUP_BUNDLE" ]] || fail 'could not determine the completed pre-deployment backup bundle'
  "$DEPLOY_DIR/infra/postgres-restore-drill.sh" --backup "$BACKUP_BUNDLE"
fi

git -C "$DEPLOY_DIR" checkout --detach "$REVISION"
[[ -z "$(git -C "$DEPLOY_DIR" status --porcelain)" ]] || fail 'deployment checkout became dirty after selecting the target revision'

DEPLOY_COMPOSE=(
  "$DOCKER_BIN" compose
  --env-file "$ENV_FILE"
  -f "$DEPLOY_DIR/compose.yaml"
  -f "$DEPLOY_DIR/compose.prod.yaml"
)
"${DEPLOY_COMPOSE[@]}" config --quiet

set +e
"${DEPLOY_COMPOSE[@]}" up -d --no-build --wait --remove-orphans
DEPLOY_STATUS=$?
set -e

if (( DEPLOY_STATUS != 0 )); then
  printf 'ERROR: deployment failed; attempting application rollback to %s\n' "$PREVIOUS_REVISION" >&2
  if git -C "$DEPLOY_DIR" cat-file -e "$PREVIOUS_REVISION^{commit}" 2>/dev/null \
     && "$DOCKER_BIN" image inspect "dondok-backend:$PREVIOUS_REVISION" >/dev/null 2>&1 \
     && "$DOCKER_BIN" image inspect "dondok-frontend:$PREVIOUS_REVISION" >/dev/null 2>&1; then
    git -C "$DEPLOY_DIR" checkout --detach "$PREVIOUS_REVISION"
    export DONDOK_BACKEND_IMAGE="dondok-backend:$PREVIOUS_REVISION"
    export DONDOK_FRONTEND_IMAGE="dondok-frontend:$PREVIOUS_REVISION"
    ROLLBACK_COMPOSE=(
      "$DOCKER_BIN" compose
      --env-file "$ENV_FILE"
      -f "$DEPLOY_DIR/compose.yaml"
      -f "$DEPLOY_DIR/compose.prod.yaml"
    )
    "${ROLLBACK_COMPOSE[@]}" up -d --no-build --wait --remove-orphans \
      || printf 'ERROR: application rollback also failed; inspect Compose logs and the pre-deployment backup\n' >&2
  else
    printf 'ERROR: no previous SHA-tagged application images are available for automatic rollback\n' >&2
  fi
  exit "$DEPLOY_STATUS"
fi

REVISION_PARTIAL="$STATE_DIR/.current-revision.$$"
printf '%s\n' "$REVISION" > "$REVISION_PARTIAL"
chmod 600 "$REVISION_PARTIAL"
mv "$REVISION_PARTIAL" "$REVISION_FILE"

printf 'DEPLOY completed revision=%s\n' "$REVISION"

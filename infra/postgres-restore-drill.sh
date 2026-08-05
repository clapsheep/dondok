#!/usr/bin/env bash

set -Eeuo pipefail
umask 077
export LC_ALL=C
export LANG=C
export LC_CTYPE=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
BACKUP_BUNDLE=""
DENYLIST_FILE=""
LOCK_DIR=""
LOCK_ACQUIRED=false
DRILL_CONTAINER=""
DRILL_VOLUME=""
RUN_ID=""
DRILL_CONTAINER_CREATED=false
DRILL_VOLUME_CREATED=false

usage() {
  cat <<'EOF'
Usage:
  infra/postgres-restore-drill.sh --backup /absolute/path/to/bundle [options]

Options:
  --denylist PATH      Optional 0600 file containing one deleted ledger UUID per line
  -h, --help           Show this help

This command verifies an archive in a network-isolated throwaway PostgreSQL.
It never promotes the restored database to production.
EOF
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

cleanup_fallback() {
  if [[ "$DRILL_CONTAINER_CREATED" == true && -n "$DRILL_CONTAINER" ]]; then
    if [[ "$(docker container inspect -f '{{ index .Config.Labels "com.dondok.run-id" }}' "$DRILL_CONTAINER" 2>/dev/null || true)" == "$RUN_ID" ]]; then
      docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || warn "failed to remove restore drill container: $DRILL_CONTAINER"
    fi
  fi
  if [[ "$DRILL_VOLUME_CREATED" == true && -n "$DRILL_VOLUME" ]]; then
    if [[ "$(docker volume inspect -f '{{ index .Labels "com.dondok.run-id" }}' "$DRILL_VOLUME" 2>/dev/null || true)" == "$RUN_ID" ]]; then
      docker volume rm "$DRILL_VOLUME" >/dev/null 2>&1 || warn "failed to remove restore drill volume: $DRILL_VOLUME"
    fi
  fi
  if [[ "$LOCK_ACQUIRED" == true && -n "$LOCK_DIR" && -d "$LOCK_DIR" ]]; then
    rm -rf -- "$LOCK_DIR"
  fi
}

cleanup_owned_resources() {
  if [[ "$DRILL_CONTAINER_CREATED" == true ]]; then
    [[ "$(docker container inspect -f '{{ index .Config.Labels "com.dondok.run-id" }}' "$DRILL_CONTAINER")" == "$RUN_ID" ]] || return 1
    docker rm -f "$DRILL_CONTAINER" >/dev/null || return 1
    docker container inspect "$DRILL_CONTAINER" >/dev/null 2>&1 && return 1
    DRILL_CONTAINER_CREATED=false
  fi
  if [[ "$DRILL_VOLUME_CREATED" == true ]]; then
    [[ "$(docker volume inspect -f '{{ index .Labels "com.dondok.run-id" }}' "$DRILL_VOLUME")" == "$RUN_ID" ]] || return 1
    docker volume rm "$DRILL_VOLUME" >/dev/null || return 1
    docker volume inspect "$DRILL_VOLUME" >/dev/null 2>&1 && return 1
    DRILL_VOLUME_CREATED=false
  fi
  if [[ -n "$LOCK_DIR" ]]; then
    rm -f -- "$LOCK_DIR/owner.txt" || return 1
    rmdir "$LOCK_DIR" || return 1
    LOCK_DIR=""
    LOCK_ACQUIRED=false
  fi
  return 0
}

trap cleanup_fallback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup)
      [[ $# -ge 2 ]] || fail '--backup requires a value'
      BACKUP_BUNDLE="$2"
      shift 2
      ;;
    --denylist)
      [[ $# -ge 2 ]] || fail '--denylist requires a value'
      DENYLIST_FILE="$2"
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

[[ -n "$BACKUP_BUNDLE" ]] || fail '--backup is required'
[[ "$BACKUP_BUNDLE" == /* ]] || fail 'backup bundle must be an absolute path'
[[ -d "$BACKUP_BUNDLE" && ! -L "$BACKUP_BUNDLE" ]] || fail 'backup bundle must be a regular directory'
BACKUP_BUNDLE="$(cd "$BACKUP_BUNDLE" && pwd -P)"
[[ "${BACKUP_BUNDLE##*/}" =~ ^dondok-postgres-[0-9]{8}T[0-9]{6}Z$ ]] \
  || fail 'backup bundle directory name is invalid'

DUMP_FILE="$BACKUP_BUNDLE/database.dump"
CHECKSUM_FILE="$BACKUP_BUNDLE/database.dump.sha256"
MANIFEST_FILE="$BACKUP_BUNDLE/manifest.txt"
MANIFEST_CHECKSUM_FILE="$BACKUP_BUNDLE/manifest.txt.sha256"

file_mode() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

require_private_file() {
  local path="$1"
  local label="$2"
  [[ -f "$path" && ! -L "$path" ]] || fail "$label must be a regular non-symlink file: $path"
  [[ -O "$path" ]] || fail "$label must be owned by the current user: $path"
  [[ -r "$path" ]] || fail "$label is not readable: $path"
  local mode
  mode="$(file_mode "$path")"
  mode="${mode#0}"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "could not determine $label permissions: $path"
  (( (8#$mode & 077) == 0 )) || fail "$label must not be readable by group or others: $path"
}

require_private_directory() {
  local path="$1"
  local label="$2"
  [[ -d "$path" && ! -L "$path" ]] || fail "$label must be a regular non-symlink directory: $path"
  [[ -O "$path" ]] || fail "$label must be owned by the current user: $path"
  local mode
  mode="$(file_mode "$path")"
  mode="${mode#0}"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "could not determine $label permissions: $path"
  (( (8#$mode & 077) == 0 )) || fail "$label must not be accessible by group or others: $path"
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    fail 'shasum or sha256sum is required'
  fi
}

manifest_value() {
  local key="$1"
  local count value
  count="$(awk -F= -v key="$key" '$1 == key {count += 1} END {print count + 0}' "$MANIFEST_FILE")"
  [[ "$count" == 1 ]] || fail "backup manifest must contain exactly one $key entry"
  value="$(awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print}' "$MANIFEST_FILE")"
  [[ -n "$value" ]] || fail "backup manifest entry is empty: $key"
  printf '%s' "$value"
}

[[ -s "$DUMP_FILE" && -f "$CHECKSUM_FILE" && -f "$MANIFEST_FILE" && -f "$MANIFEST_CHECKSUM_FILE" ]] \
  || fail 'backup bundle is incomplete'
BACKUP_ROOT="$(dirname "$BACKUP_BUNDLE")"
[[ "$BACKUP_ROOT" != / && "$BACKUP_ROOT" != "$HOME" ]] \
  || fail 'backup root must be a dedicated subdirectory, not the filesystem root or home directory'
require_private_directory "$BACKUP_ROOT" 'backup root'
require_private_directory "$BACKUP_BUNDLE" 'backup bundle'
require_private_file "$DUMP_FILE" 'database archive'
require_private_file "$CHECKSUM_FILE" 'database archive checksum'
require_private_file "$MANIFEST_FILE" 'backup manifest'
require_private_file "$MANIFEST_CHECKSUM_FILE" 'backup manifest checksum'
if [[ -n "$DENYLIST_FILE" ]]; then
  [[ "$DENYLIST_FILE" == /* ]] || fail 'denylist must be an absolute path'
  require_private_file "$DENYLIST_FILE" 'deleted-ledger denylist'
fi

LOCK_DIR="$BACKUP_ROOT/.maintenance.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "maintenance lock already exists: $LOCK_DIR"
fi
LOCK_ACQUIRED=true
chmod 700 "$LOCK_DIR"
printf 'pid=%s\nstarted_at_utc=%s\noperation=restore-drill\n' "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LOCK_DIR/owner.txt"
chmod 600 "$LOCK_DIR/owner.txt"

CHECKSUM_LINE="$(sed -n '1p' "$CHECKSUM_FILE")"
[[ "$(wc -l < "$CHECKSUM_FILE" | tr -d ' ')" == 1 ]] || fail 'backup checksum file must contain exactly one line'
[[ "$CHECKSUM_LINE" =~ ^([0-9a-fA-F]{64})[[:space:]][[:space:]]database\.dump$ ]] \
  || fail 'backup checksum file is invalid'
EXPECTED_CHECKSUM="${BASH_REMATCH[1]}"
ACTUAL_CHECKSUM="$(sha256_file "$DUMP_FILE")"
[[ "$ACTUAL_CHECKSUM" == "$EXPECTED_CHECKSUM" ]] || fail 'backup checksum mismatch; restore was not started'

MANIFEST_CHECKSUM_LINE="$(sed -n '1p' "$MANIFEST_CHECKSUM_FILE")"
[[ "$(wc -l < "$MANIFEST_CHECKSUM_FILE" | tr -d ' ')" == 1 ]] \
  || fail 'backup manifest checksum file must contain exactly one line'
[[ "$MANIFEST_CHECKSUM_LINE" =~ ^([0-9a-fA-F]{64})[[:space:]][[:space:]]manifest\.txt$ ]] \
  || fail 'backup manifest checksum file is invalid'
EXPECTED_MANIFEST_CHECKSUM="${BASH_REMATCH[1]}"
ACTUAL_MANIFEST_CHECKSUM="$(sha256_file "$MANIFEST_FILE")"
[[ "$ACTUAL_MANIFEST_CHECKSUM" == "$EXPECTED_MANIFEST_CHECKSUM" ]] \
  || fail 'backup manifest checksum mismatch; restore was not started'

MANIFEST_BACKUP_ID="$(manifest_value backup_id)"
MANIFEST_ARCHIVE_BYTES="$(manifest_value archive_bytes)"
MANIFEST_DATABASE_BYTES="$(manifest_value database_bytes)"
MANIFEST_FLYWAY_VERSION="$(manifest_value flyway_version)"
MANIFEST_POSTGRES_VERSION_NUM="$(manifest_value postgres_version_num)"
MANIFEST_POSTGRES_IMAGE_ID="$(manifest_value postgres_image_id)"
MANIFEST_POSTGRES_IMAGE_DIGEST="$(manifest_value postgres_image_digest)"
[[ "$MANIFEST_BACKUP_ID" == "${BACKUP_BUNDLE##*/}" ]] || fail 'backup manifest ID does not match its bundle directory'
[[ "$MANIFEST_ARCHIVE_BYTES" =~ ^[1-9][0-9]*$ ]] || fail 'backup manifest archive size is invalid'
[[ "$MANIFEST_DATABASE_BYTES" =~ ^[1-9][0-9]*$ ]] || fail 'backup manifest database size is invalid'
[[ "$(wc -c < "$DUMP_FILE" | tr -d ' ')" == "$MANIFEST_ARCHIVE_BYTES" ]] || fail 'backup archive size differs from its manifest'
[[ "$MANIFEST_FLYWAY_VERSION" =~ ^[0-9]+$ ]] || fail 'backup manifest Flyway version is invalid'
[[ "$MANIFEST_POSTGRES_VERSION_NUM" =~ ^[0-9]+$ ]] || fail 'backup manifest PostgreSQL version is invalid'
[[ "$MANIFEST_POSTGRES_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'backup manifest PostgreSQL image ID is invalid'
[[ "$MANIFEST_POSTGRES_IMAGE_DIGEST" =~ ^postgres@sha256:[0-9a-f]{64}$ ]] \
  || fail 'backup manifest PostgreSQL image digest is invalid'

command -v docker >/dev/null 2>&1 || fail 'docker CLI is required'
docker info >/dev/null 2>&1 || fail 'Docker daemon is unavailable'
cd "$REPOSITORY_DIR"

REPOSITORY_FLYWAY_VERSION="$(find "$REPOSITORY_DIR/backend/src/main/resources/db/migration" -maxdepth 1 -type f -name 'V*__*.sql' -print \
  | sed -E 's#^.*/V([0-9]+)__.*#\1#' \
  | sort -n \
  | tail -1)"
[[ "$REPOSITORY_FLYWAY_VERSION" =~ ^[0-9]+$ ]] || fail 'could not determine repository Flyway version'
[[ "$MANIFEST_FLYWAY_VERSION" == "$REPOSITORY_FLYWAY_VERSION" ]] \
  || fail "backup Flyway version $MANIFEST_FLYWAY_VERSION does not match repository version $REPOSITORY_FLYWAY_VERSION"

if docker image inspect "$MANIFEST_POSTGRES_IMAGE_ID" >/dev/null 2>&1; then
  RESTORE_IMAGE="$MANIFEST_POSTGRES_IMAGE_ID"
elif docker image inspect "$MANIFEST_POSTGRES_IMAGE_DIGEST" >/dev/null 2>&1; then
  RESTORE_IMAGE="$MANIFEST_POSTGRES_IMAGE_DIGEST"
else
  fail "backup PostgreSQL image is unavailable locally; pull the recorded digest first: $MANIFEST_POSTGRES_IMAGE_DIGEST"
fi
[[ "$(docker image inspect -f '{{.Id}}' "$RESTORE_IMAGE")" == "$MANIFEST_POSTGRES_IMAGE_ID" ]] \
  || fail 'local PostgreSQL image does not match the backup manifest image ID'

docker run --rm --network none -i "$RESTORE_IMAGE" pg_restore --list < "$DUMP_FILE" >/dev/null

STALE_CONTAINERS="$(docker ps -aq --filter label=com.dondok.purpose=restore-drill | wc -l | tr -d ' ')"
STALE_VOLUMES="$(docker volume ls -q --filter label=com.dondok.purpose=restore-drill | wc -l | tr -d ' ')"
if (( STALE_CONTAINERS > 0 || STALE_VOLUMES > 0 )); then
  warn "found existing restore-drill resources (containers=$STALE_CONTAINERS volumes=$STALE_VOLUMES); review them before disk pressure becomes material"
fi

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
DRILL_CONTAINER="dondok-restore-drill-$RUN_ID"
DRILL_VOLUME="dondok-restore-drill-$RUN_ID"
if docker container inspect "$DRILL_CONTAINER" >/dev/null 2>&1; then
  fail "restore drill container name already exists: $DRILL_CONTAINER"
fi
if docker volume inspect "$DRILL_VOLUME" >/dev/null 2>&1; then
  fail "restore drill volume name already exists: $DRILL_VOLUME"
fi

docker volume create \
  --label com.dondok.purpose=restore-drill \
  --label "com.dondok.run-id=$RUN_ID" \
  "$DRILL_VOLUME" >/dev/null
DRILL_VOLUME_CREATED=true

if ! docker run -d \
  --name "$DRILL_CONTAINER" \
  --network none \
  --memory 1g \
  --cpus 1.5 \
  --label com.dondok.purpose=restore-drill \
  --label "com.dondok.run-id=$RUN_ID" \
  --mount "type=volume,source=$DRILL_VOLUME,target=/var/lib/postgresql" \
  -e POSTGRES_DB=dondok_restore_drill \
  -e POSTGRES_USER=dondok_restore \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e TZ=UTC \
  "$RESTORE_IMAGE" >/dev/null; then
  if [[ "$(docker container inspect -f '{{ index .Config.Labels "com.dondok.run-id" }}' "$DRILL_CONTAINER" 2>/dev/null || true)" == "$RUN_ID" ]]; then
    DRILL_CONTAINER_CREATED=true
  fi
  fail 'could not start restore drill PostgreSQL container'
fi
DRILL_CONTAINER_CREATED=true

READY=false
for _ in $(seq 1 60); do
  if docker exec "$DRILL_CONTAINER" pg_isready --username dondok_restore --dbname dondok_restore_drill >/dev/null 2>&1; then
    READY=true
    break
  fi
  if [[ "$(docker container inspect -f '{{.State.Running}}' "$DRILL_CONTAINER" 2>/dev/null || printf false)" != true ]]; then
    docker logs --tail 30 "$DRILL_CONTAINER" >&2 || true
    fail 'restore drill PostgreSQL exited before becoming ready'
  fi
  sleep 1
done
[[ "$READY" == true ]] || fail 'restore drill PostgreSQL did not become ready in 60 seconds'

RESTORE_POSTGRES_VERSION_NUM="$(docker exec "$DRILL_CONTAINER" psql --username dondok_restore --dbname dondok_restore_drill -Atqc 'show server_version_num')"
[[ "$RESTORE_POSTGRES_VERSION_NUM" == "$MANIFEST_POSTGRES_VERSION_NUM" ]] \
  || fail 'restore PostgreSQL version does not match the backup manifest'

AVAILABLE_KB="$(docker exec "$DRILL_CONTAINER" df -Pk /var/lib/postgresql | awk 'NR == 2 {print $4}')"
[[ "$AVAILABLE_KB" =~ ^[0-9]+$ ]] || fail 'could not determine Docker volume free space'
REQUIRED_BYTES=$((MANIFEST_DATABASE_BYTES * 3 + 1073741824))
AVAILABLE_BYTES=$((AVAILABLE_KB * 1024))
(( AVAILABLE_BYTES >= REQUIRED_BYTES )) \
  || fail "insufficient Docker volume space for restore drill (available=$AVAILABLE_BYTES required=$REQUIRED_BYTES)"

TARGET_OBJECTS="$(docker exec "$DRILL_CONTAINER" psql --username dondok_restore --dbname dondok_restore_drill -Atqc \
  "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p','v','m')")"
[[ "$TARGET_OBJECTS" == 0 ]] || fail 'restore target is not empty'

docker exec -i "$DRILL_CONTAINER" pg_restore \
  --username dondok_restore \
  --dbname dondok_restore_drill \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-acl < "$DUMP_FILE"

docker exec -i "$DRILL_CONTAINER" psql \
  --username dondok_restore \
  --dbname dondok_restore_drill \
  -v ON_ERROR_STOP=1 \
  -v "expected_flyway_version=$MANIFEST_FLYWAY_VERSION" \
  -f - < "$SCRIPT_DIR/sql/restore-verify.sql"

if [[ -n "$DENYLIST_FILE" ]]; then
  LINE_NUMBER=0
  DENYLIST_COUNT=0
  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    LINE_NUMBER=$((LINE_NUMBER + 1))
    ledger_id="${raw_line%%#*}"
    ledger_id="$(printf '%s' "$ledger_id" | tr -d '[:space:]')"
    [[ -n "$ledger_id" ]] || continue
    [[ "$ledger_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
      || fail "denylist line $LINE_NUMBER is not a UUID"
    DENYLIST_COUNT=$((DENYLIST_COUNT + 1))
    present="$(printf "select count(*) from ledger_book where id = :'ledger_id'::uuid;\n" \
      | docker exec -i "$DRILL_CONTAINER" psql \
          --username dondok_restore \
          --dbname dondok_restore_drill \
          -v ON_ERROR_STOP=1 \
          -v "ledger_id=$ledger_id" \
          -Atq)"
    [[ "$present" == 0 ]] || fail "restored backup contains a deleted ledger from denylist line $LINE_NUMBER"
  done < "$DENYLIST_FILE"
  if (( DENYLIST_COUNT > 0 )); then
    printf 'DELETION-GATE passed entries=%s\n' "$DENYLIST_COUNT"
  else
    warn 'deleted-ledger denylist contained no UUIDs; no deletion replay evidence was verified'
  fi
else
  warn 'no deleted-ledger denylist was supplied; this drill is not sufficient for disaster cutover'
fi

cleanup_owned_resources || fail 'restore drill verification passed, but temporary resource cleanup failed'

printf 'RESTORE-DRILL completed backup=%s flyway=%s sha256=%s\n' \
  "${BACKUP_BUNDLE##*/}" "$MANIFEST_FLYWAY_VERSION" "$ACTUAL_CHECKSUM"

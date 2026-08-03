#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
ENV_FILE="$REPOSITORY_DIR/.env"
BACKUP_DIR=""
COMPOSE_FILES=()
RETENTION_DAYS=30
RETENTION_ONLY=false
DRY_RUN_RETENTION=false
LOCK_DIR=""
LOCK_ACQUIRED=false
PARTIAL_DIR=""

usage() {
  cat <<'EOF'
Usage:
  infra/postgres-backup.sh --backup-dir /absolute/path [options]

Options:
  --env-file PATH          Compose environment file (default: repository .env)
  --compose-file PATH      Compose file used by the running stack; repeat in launch order
  --retention-days DAYS    Completed backup retention in 24-hour days (default: 30)
  --retention-only         Do not contact PostgreSQL; apply retention only
  --dry-run-retention      Print expired bundles without removing them
  -h, --help               Show this help
EOF
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

cleanup() {
  if [[ -n "$PARTIAL_DIR" && -d "$PARTIAL_DIR" ]]; then
    rm -rf -- "$PARTIAL_DIR"
  fi
  if [[ "$LOCK_ACQUIRED" == true && -n "$LOCK_DIR" && -d "$LOCK_DIR" ]]; then
    rm -rf -- "$LOCK_DIR"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup-dir)
      [[ $# -ge 2 ]] || fail '--backup-dir requires a value'
      BACKUP_DIR="$2"
      shift 2
      ;;
    --env-file)
      [[ $# -ge 2 ]] || fail '--env-file requires a value'
      ENV_FILE="$2"
      shift 2
      ;;
    --compose-file)
      [[ $# -ge 2 ]] || fail '--compose-file requires a value'
      COMPOSE_FILES+=("$2")
      shift 2
      ;;
    --retention-days)
      [[ $# -ge 2 ]] || fail '--retention-days requires a value'
      RETENTION_DAYS="$2"
      shift 2
      ;;
    --retention-only)
      RETENTION_ONLY=true
      shift
      ;;
    --dry-run-retention)
      DRY_RUN_RETENTION=true
      shift
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

if [[ ${#COMPOSE_FILES[@]} -eq 0 ]]; then
  COMPOSE_FILES=("$REPOSITORY_DIR/compose.yaml")
fi

[[ -n "$BACKUP_DIR" ]] || fail '--backup-dir is required'
[[ "$BACKUP_DIR" == /* ]] || fail 'backup directory must be an absolute path'
[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || fail 'retention days must be a positive integer'

if [[ "$BACKUP_DIR" == "$REPOSITORY_DIR" || "$BACKUP_DIR" == "$REPOSITORY_DIR/"* ]]; then
  fail 'backup directory must be outside the repository and Docker build contexts'
fi
[[ ! -L "$BACKUP_DIR" ]] || fail 'backup directory must not be a symlink'
BACKUP_DIR_WAS_CREATED=false
if [[ ! -e "$BACKUP_DIR" ]]; then
  mkdir -p -- "$BACKUP_DIR"
  BACKUP_DIR_WAS_CREATED=true
fi
[[ -d "$BACKUP_DIR" ]] || fail 'backup directory must be a directory'
[[ -O "$BACKUP_DIR" ]] || fail 'backup directory must be owned by the current user'
if [[ "$BACKUP_DIR_WAS_CREATED" == true ]]; then
  chmod 700 "$BACKUP_DIR"
fi
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd -P)"
if [[ "$BACKUP_DIR" == "$REPOSITORY_DIR" || "$BACKUP_DIR" == "$REPOSITORY_DIR/"* ]]; then
  fail 'backup directory must be outside the repository and Docker build contexts'
fi
if [[ "$BACKUP_DIR" == / || "$BACKUP_DIR" == "$HOME" ]]; then
  fail 'backup directory must be a dedicated subdirectory, not the filesystem root or home directory'
fi

if stat -f '%Lp' "$BACKUP_DIR" >/dev/null 2>&1; then
  backup_dir_mode="$(stat -f '%Lp' "$BACKUP_DIR")"
else
  backup_dir_mode="$(stat -c '%a' "$BACKUP_DIR")"
fi
backup_dir_mode="${backup_dir_mode#0}"
[[ "$backup_dir_mode" =~ ^[0-7]{3,4}$ ]] || fail 'could not determine backup directory permissions'
(( (8#$backup_dir_mode & 077) == 0 )) || fail 'backup directory must not be accessible by group or others (run chmod 700)'

LOCK_DIR="$BACKUP_DIR/.maintenance.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "maintenance lock already exists: $LOCK_DIR"
fi
LOCK_ACQUIRED=true
chmod 700 "$LOCK_DIR"
printf 'pid=%s\nstarted_at_utc=%s\n' "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$LOCK_DIR/owner.txt"
chmod 600 "$LOCK_DIR/owner.txt"

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
  (( (8#$mode & 077) == 0 )) || fail "$label must not be readable by group or others (run chmod 600): $path"
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

parse_backup_epoch() {
  local stamp="$1"
  if date -j -u -f '%Y%m%dT%H%M%SZ' "$stamp" +%s >/dev/null 2>&1; then
    date -j -u -f '%Y%m%dT%H%M%SZ' "$stamp" +%s
    return
  fi
  local iso
  iso="${stamp:0:4}-${stamp:4:2}-${stamp:6:2}T${stamp:9:2}:${stamp:11:2}:${stamp:13:2}Z"
  date -u -d "$iso" +%s
}

apply_retention() {
  local now_epoch cutoff_seconds bundle name stamp bundle_epoch age_seconds
  now_epoch="$(date -u +%s)"
  cutoff_seconds=$((RETENTION_DAYS * 86400))

  shopt -s nullglob
  for bundle in "$BACKUP_DIR"/dondok-postgres-*; do
    [[ -d "$bundle" && ! -L "$bundle" ]] || continue
    name="${bundle##*/}"
    if [[ ! "$name" =~ ^dondok-postgres-([0-9]{8}T[0-9]{6}Z)$ ]]; then
      warn "ignoring unrecognized backup directory: $name"
      continue
    fi
    stamp="${BASH_REMATCH[1]}"
    bundle_epoch="$(parse_backup_epoch "$stamp")" || {
      warn "ignoring backup with invalid UTC timestamp: $name"
      continue
    }
    age_seconds=$((now_epoch - bundle_epoch))
    if (( age_seconds < cutoff_seconds )); then
      continue
    fi
    if [[ ! -f "$bundle/database.dump" || ! -f "$bundle/database.dump.sha256" \
       || ! -f "$bundle/manifest.txt" || ! -f "$bundle/manifest.txt.sha256" ]]; then
      warn "expired incomplete bundle will be removed: $name"
    fi
    if [[ "$DRY_RUN_RETENTION" == true ]]; then
      printf 'RETENTION would-remove %s\n' "$name"
    else
      rm -rf -- "$bundle"
      printf 'RETENTION removed %s\n' "$name"
    fi
  done
  shopt -u nullglob

  shopt -s nullglob
  for bundle in "$BACKUP_DIR"/.*.partial.*; do
    [[ -d "$bundle" && ! -L "$bundle" ]] || continue
    warn "stale partial backup requires operator review and was not removed: ${bundle##*/}"
  done
  shopt -u nullglob
}

if [[ "$RETENTION_ONLY" == true ]]; then
  apply_retention
  exit 0
fi

require_private_file "$ENV_FILE" 'environment file'
command -v docker >/dev/null 2>&1 || fail 'docker CLI is required'
docker info >/dev/null 2>&1 || fail 'Docker daemon is unavailable'

cd "$REPOSITORY_DIR"
COMPOSE=(docker compose --env-file "$ENV_FILE")
EXPECTED_CONFIG_FILES=()
for compose_file in "${COMPOSE_FILES[@]}"; do
  [[ -f "$compose_file" && ! -L "$compose_file" ]] || fail "Compose file must be a regular non-symlink file: $compose_file"
  compose_file="$(cd "$(dirname "$compose_file")" && pwd -P)/$(basename "$compose_file")"
  COMPOSE+=( -f "$compose_file" )
  EXPECTED_CONFIG_FILES+=("$compose_file")
done
"${COMPOSE[@]}" config --quiet

DB_CONTAINER="$("${COMPOSE[@]}" ps -q db)"
[[ -n "$DB_CONTAINER" && "$DB_CONTAINER" != *$'\n'* ]] || fail 'expected exactly one Compose db container'
[[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER")" == true ]] || fail 'Compose db container is not running'
[[ "$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.service" }}' "$DB_CONTAINER")" == db ]] || fail 'resolved container is not the Compose db service'
[[ "$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$DB_CONTAINER")" == "$REPOSITORY_DIR" ]] \
  || fail 'resolved db container belongs to a different repository working directory'
ACTUAL_CONFIG_FILES="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$DB_CONTAINER")"
EXPECTED_CONFIG_FILES_CSV="$(IFS=,; printf '%s' "${EXPECTED_CONFIG_FILES[*]}")"
[[ "$ACTUAL_CONFIG_FILES" == "$EXPECTED_CONFIG_FILES_CSV" ]] \
  || fail "resolved db container was started with different Compose files: $ACTUAL_CONFIG_FILES"
if [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$DB_CONTAINER")" != healthy ]]; then
  fail 'Compose db container is not healthy'
fi

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_ID="dondok-postgres-$STAMP"
FINAL_DIR="$BACKUP_DIR/$BACKUP_ID"
[[ ! -e "$FINAL_DIR" ]] || fail "backup already exists: $FINAL_DIR"
PARTIAL_DIR="$BACKUP_DIR/.$BACKUP_ID.partial.$$"
mkdir "$PARTIAL_DIR"
chmod 700 "$PARTIAL_DIR"

DUMP_FILE="$PARTIAL_DIR/database.dump"
docker exec -i "$DB_CONTAINER" sh -ceu '
  exec pg_dump \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --format=custom \
    --compress=zstd:6 \
    --no-owner \
    --no-acl \
    --lock-wait-timeout=30s
' > "$DUMP_FILE"
[[ -s "$DUMP_FILE" ]] || fail 'pg_dump produced an empty archive'
chmod 600 "$DUMP_FILE"

docker exec -i "$DB_CONTAINER" pg_restore --list < "$DUMP_FILE" >/dev/null
CHECKSUM="$(sha256_file "$DUMP_FILE")"
printf '%s  database.dump\n' "$CHECKSUM" > "$PARTIAL_DIR/database.dump.sha256"
chmod 600 "$PARTIAL_DIR/database.dump.sha256"

DATABASE_NAME="$(docker exec -i "$DB_CONTAINER" sh -ceu 'printf "%s" "$POSTGRES_DB"')"
POSTGRES_VERSION="$(docker exec -i "$DB_CONTAINER" sh -ceu 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -Atqc "show server_version"')"
POSTGRES_VERSION_NUM="$(docker exec -i "$DB_CONTAINER" sh -ceu 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -Atqc "show server_version_num"')"
DATABASE_BYTES="$(docker exec -i "$DB_CONTAINER" sh -ceu 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -Atqc "select pg_database_size(current_database())"')"
PG_DUMP_VERSION="$(docker exec -i "$DB_CONTAINER" pg_dump --version)"
FLYWAY_VERSION="$(docker exec -i "$DB_CONTAINER" sh -ceu 'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -Atqc "select coalesce(version, '\''none'\'') from flyway_schema_history where success order by installed_rank desc limit 1"')"
POSTGRES_IMAGE_REF="$(docker inspect -f '{{.Config.Image}}' "$DB_CONTAINER")"
POSTGRES_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$DB_CONTAINER")"
POSTGRES_IMAGE_DIGEST="$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$POSTGRES_IMAGE_ID" \
  | awk '/^postgres@sha256:/ {print; exit}')"
[[ "$DATABASE_BYTES" =~ ^[1-9][0-9]*$ ]] || fail 'could not determine PostgreSQL database size'
[[ "$POSTGRES_IMAGE_REF" =~ ^postgres:[0-9]+\.[0-9]+-alpine$ ]] \
  || fail "db image must use the pinned official postgres:<major>.<minor>-alpine form: $POSTGRES_IMAGE_REF"
[[ "$POSTGRES_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'could not determine immutable PostgreSQL image ID'
[[ "$POSTGRES_IMAGE_DIGEST" =~ ^postgres@sha256:[0-9a-f]{64}$ ]] || fail 'could not determine immutable PostgreSQL repository digest'
COMPLETED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ARCHIVE_BYTES="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
GIT_REVISION="$(git rev-parse --verify HEAD 2>/dev/null || printf 'unavailable')"

cat > "$PARTIAL_DIR/manifest.txt" <<EOF
backup_id=$BACKUP_ID
started_at_utc=$STARTED_AT
completed_at_utc=$COMPLETED_AT
database_name=$DATABASE_NAME
postgres_version=$POSTGRES_VERSION
postgres_version_num=$POSTGRES_VERSION_NUM
database_bytes=$DATABASE_BYTES
pg_dump_version=$PG_DUMP_VERSION
postgres_image_ref=$POSTGRES_IMAGE_REF
postgres_image_id=$POSTGRES_IMAGE_ID
postgres_image_digest=$POSTGRES_IMAGE_DIGEST
flyway_version=$FLYWAY_VERSION
archive_bytes=$ARCHIVE_BYTES
git_revision=$GIT_REVISION
retention_days=$RETENTION_DAYS
EOF
chmod 600 "$PARTIAL_DIR/manifest.txt"
MANIFEST_CHECKSUM="$(sha256_file "$PARTIAL_DIR/manifest.txt")"
printf '%s  manifest.txt\n' "$MANIFEST_CHECKSUM" > "$PARTIAL_DIR/manifest.txt.sha256"
chmod 600 "$PARTIAL_DIR/manifest.txt.sha256"

mv "$PARTIAL_DIR" "$FINAL_DIR"
PARTIAL_DIR=""
printf 'BACKUP completed %s\n' "$FINAL_DIR"

apply_retention

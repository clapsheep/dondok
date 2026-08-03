#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
ENV_FILE="$REPOSITORY_DIR/.env"
COMPOSE_FILES=("$REPOSITORY_DIR/compose.yaml" "$REPOSITORY_DIR/compose.dev.yaml")
WORK_ROOT=""
OUTSIDE_TARGET=""

usage() {
  cat <<'EOF'
Usage:
  infra/tests/postgres-maintenance-smoke.sh [options]

Options:
  --env-file PATH          Compose environment file (default: repository .env)
  --compose-file PATH      Compose file used by the running stack; first use replaces defaults
  -h, --help               Show this help

The source PostgreSQL is only dumped/read. All backup files and restore resources are temporary.
EOF
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$WORK_ROOT" && -d "$WORK_ROOT" ]]; then
    rm -rf -- "$WORK_ROOT"
  fi
  if [[ -n "$OUTSIDE_TARGET" && -d "$OUTSIDE_TARGET" ]]; then
    rm -rf -- "$OUTSIDE_TARGET"
  fi
}

trap cleanup EXIT

compose_overridden=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      [[ $# -ge 2 ]] || fail '--env-file requires a value'
      ENV_FILE="$2"
      shift 2
      ;;
    --compose-file)
      [[ $# -ge 2 ]] || fail '--compose-file requires a value'
      if [[ "$compose_overridden" == false ]]; then
        COMPOSE_FILES=()
        compose_overridden=true
      fi
      COMPOSE_FILES+=("$2")
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

[[ "$ENV_FILE" == /* ]] || fail 'environment file must be an absolute path'
[[ ${#COMPOSE_FILES[@]} -gt 0 ]] || fail 'at least one Compose file is required'

date_days_ago() {
  local days="$1"
  if date -u -v-"${days}"d +%Y%m%dT%H%M%SZ >/dev/null 2>&1; then
    date -u -v-"${days}"d +%Y%m%dT%H%M%SZ
  else
    date -u -d "$days days ago" +%Y%m%dT%H%M%SZ
  fi
}

BACKUP_ARGS=(
  --env-file "$ENV_FILE"
  --backup-dir placeholder
  --retention-days 30
)
for compose_file in "${COMPOSE_FILES[@]}"; do
  [[ "$compose_file" == /* ]] || fail 'Compose files must use absolute paths'
  BACKUP_ARGS+=(--compose-file "$compose_file")
done

INITIAL_CONTAINERS="$(docker ps -aq --filter label=com.dondok.purpose=restore-drill | wc -l | tr -d ' ')"
INITIAL_VOLUMES="$(docker volume ls -q --filter label=com.dondok.purpose=restore-drill | wc -l | tr -d ' ')"

WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dondok-maintenance-smoke.XXXXXX")"
chmod 700 "$WORK_ROOT"
BACKUP_ARGS[3]="$WORK_ROOT"

"$REPOSITORY_DIR/infra/postgres-backup.sh" "${BACKUP_ARGS[@]}" > "$WORK_ROOT/backup.log" 2>&1
BUNDLE="$(find "$WORK_ROOT" -maxdepth 1 -type d -name 'dondok-postgres-*' -print -quit)"
[[ -n "$BUNDLE" ]] || fail 'backup smoke did not create a completed bundle'
[[ "$(stat -f '%Lp' "$BUNDLE" 2>/dev/null || stat -c '%a' "$BUNDLE")" == 700 ]] || fail 'backup bundle mode is not 0700'
for private_file in database.dump database.dump.sha256 manifest.txt manifest.txt.sha256; do
  mode="$(stat -f '%Lp' "$BUNDLE/$private_file" 2>/dev/null || stat -c '%a' "$BUNDLE/$private_file")"
  [[ "$mode" == 600 ]] || fail "$private_file mode is not 0600"
done

"$REPOSITORY_DIR/infra/postgres-restore-drill.sh" --backup "$BUNDLE" > "$WORK_ROOT/restore.log" 2>&1

DENYLIST="$WORK_ROOT/deleted-ledger-denylist.test"
printf '%s\n' '00000000-0000-0000-0000-000000000000' > "$DENYLIST"
chmod 600 "$DENYLIST"
"$REPOSITORY_DIR/infra/postgres-restore-drill.sh" --backup "$BUNDLE" --denylist "$DENYLIST" \
  > "$WORK_ROOT/restore-denylist.log" 2>&1
rg -q 'DELETION-GATE passed entries=1' "$WORK_ROOT/restore-denylist.log" \
  || fail 'denylist verification did not pass'

CORRUPT_BUNDLE="$WORK_ROOT/dondok-postgres-20990101T000000Z"
cp -R "$BUNDLE" "$CORRUPT_BUNDLE"
printf 'x' >> "$CORRUPT_BUNDLE/database.dump"
set +e
"$REPOSITORY_DIR/infra/postgres-restore-drill.sh" --backup "$CORRUPT_BUNDLE" \
  > "$WORK_ROOT/corrupt.log" 2>&1
CORRUPT_STATUS=$?
set -e
[[ "$CORRUPT_STATUS" -ne 0 ]] || fail 'corrupted archive was accepted'
rg -q 'backup checksum mismatch; restore was not started' "$WORK_ROOT/corrupt.log" \
  || fail 'corrupted archive was not rejected at the checksum boundary'
rm -rf -- "$CORRUPT_BUNDLE"

RETENTION_ROOT="$WORK_ROOT/retention"
mkdir "$RETENTION_ROOT"
chmod 700 "$RETENTION_ROOT"
STAMP29="$(date_days_ago 29)"
STAMP30="$(date_days_ago 30)"
STAMP31="$(date_days_ago 31)"
mkdir \
  "$RETENTION_ROOT/dondok-postgres-$STAMP29" \
  "$RETENTION_ROOT/dondok-postgres-$STAMP30" \
  "$RETENTION_ROOT/dondok-postgres-$STAMP31" \
  "$RETENTION_ROOT/.dondok-postgres-$STAMP31.partial.999"
OUTSIDE_TARGET="$(mktemp -d "${TMPDIR:-/tmp}/dondok-maintenance-outside.XXXXXX")"
ln -s "$OUTSIDE_TARGET" "$RETENTION_ROOT/dondok-postgres-20000101T000000Z"

"$REPOSITORY_DIR/infra/postgres-backup.sh" \
  --backup-dir "$RETENTION_ROOT" --retention-days 30 --retention-only --dry-run-retention \
  > "$WORK_ROOT/retention-dry.log" 2>&1
[[ "$(rg -c 'RETENTION would-remove' "$WORK_ROOT/retention-dry.log")" == 2 ]] \
  || fail 'retention dry-run did not select exactly the 30- and 31-day bundles'
"$REPOSITORY_DIR/infra/postgres-backup.sh" \
  --backup-dir "$RETENTION_ROOT" --retention-days 30 --retention-only \
  > "$WORK_ROOT/retention.log" 2>&1
[[ -d "$RETENTION_ROOT/dondok-postgres-$STAMP29" ]] || fail '29-day bundle was removed'
[[ ! -e "$RETENTION_ROOT/dondok-postgres-$STAMP30" ]] || fail '30-day bundle was retained'
[[ ! -e "$RETENTION_ROOT/dondok-postgres-$STAMP31" ]] || fail '31-day bundle was retained'
[[ -d "$RETENTION_ROOT/.dondok-postgres-$STAMP31.partial.999" ]] || fail 'partial bundle was removed'
[[ -L "$RETENTION_ROOT/dondok-postgres-20000101T000000Z" && -d "$OUTSIDE_TARGET" ]] \
  || fail 'retention followed or removed a symlink target'

mkdir "$RETENTION_ROOT/.maintenance.lock"
set +e
"$REPOSITORY_DIR/infra/postgres-backup.sh" --backup-dir "$RETENTION_ROOT" --retention-only \
  > "$WORK_ROOT/lock.log" 2>&1
LOCK_STATUS=$?
set -e
[[ "$LOCK_STATUS" -ne 0 && -d "$RETENTION_ROOT/.maintenance.lock" ]] \
  || fail 'competing maintenance removed or ignored a foreign lock'

FINAL_CONTAINERS="$(docker ps -aq --filter label=com.dondok.purpose=restore-drill | wc -l | tr -d ' ')"
FINAL_VOLUMES="$(docker volume ls -q --filter label=com.dondok.purpose=restore-drill | wc -l | tr -d ' ')"
[[ "$FINAL_CONTAINERS" == "$INITIAL_CONTAINERS" ]] || fail 'restore drill leaked a container'
[[ "$FINAL_VOLUMES" == "$INITIAL_VOLUMES" ]] || fail 'restore drill leaked a volume'

printf 'PostgreSQL maintenance smoke passed\n'

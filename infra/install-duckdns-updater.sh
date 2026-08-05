#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
DOMAIN=""
SECRET_FILE="${HOME}/.config/dondok/duckdns.env"
LOG_DIR="${HOME}/Library/Logs/dondok"
REPLACE=false
PLIST_TEMPLATE="$REPOSITORY_DIR/infra/launchd/com.dondok.duckdns-update.plist.example"
PLIST_TARGET="${HOME}/Library/LaunchAgents/com.dondok.duckdns-update.plist"
LABEL="com.dondok.duckdns-update"

usage() {
  printf '%s\n' \
    'Usage: infra/install-duckdns-updater.sh --domain SUBDOMAIN [--secret-file PATH]' \
    '       [--log-dir PATH] [--replace]'
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      [[ $# -ge 2 ]] || fail '--domain requires a value'
      DOMAIN="$2"
      shift 2
      ;;
    --secret-file)
      [[ $# -ge 2 ]] || fail '--secret-file requires a value'
      SECRET_FILE="$2"
      shift 2
      ;;
    --log-dir)
      [[ $# -ge 2 ]] || fail '--log-dir requires a value'
      LOG_DIR="$2"
      shift 2
      ;;
    --replace)
      REPLACE=true
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

[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] \
  || fail '--domain must be a single lowercase DuckDNS subdomain'
for absolute_path in "$SECRET_FILE" "$LOG_DIR" "$PLIST_TARGET"; do
  [[ "$absolute_path" == /* ]] || fail 'secret, log and LaunchAgent paths must be absolute'
done
[[ -t 0 ]] || fail 'run this installer from an interactive terminal so the token can be entered privately'
[[ -f "$PLIST_TEMPLATE" ]] || fail 'DuckDNS LaunchAgent template is missing'

if [[ "$REPLACE" != true && ( -e "$SECRET_FILE" || -e "$PLIST_TARGET" ) ]]; then
  fail 'an existing DuckDNS secret or LaunchAgent was found; review it and rerun with --replace'
fi

printf 'DuckDNS token (hidden): ' >&2
IFS= read -r -s DUCKDNS_TOKEN
printf '\n' >&2
[[ "$DUCKDNS_TOKEN" =~ ^[A-Za-z0-9-]{20,128}$ ]] || fail 'token has an invalid format'

mkdir -p -- "$(dirname "$SECRET_FILE")" "$LOG_DIR" "$(dirname "$PLIST_TARGET")"
chmod 700 "$(dirname "$SECRET_FILE")" "$LOG_DIR"

SECRET_TEMP="$(mktemp "${SECRET_FILE}.tmp.XXXXXX")"
PLIST_TEMP="$(mktemp "${PLIST_TARGET}.tmp.XXXXXX")"
cleanup() {
  rm -f -- "$SECRET_TEMP" "$PLIST_TEMP"
}
trap cleanup EXIT

printf 'DUCKDNS_DOMAIN=%s\nDUCKDNS_TOKEN=%s\n' "$DOMAIN" "$DUCKDNS_TOKEN" > "$SECRET_TEMP"
chmod 600 "$SECRET_TEMP"
mv -f -- "$SECRET_TEMP" "$SECRET_FILE"
chmod 600 "$SECRET_FILE"
DUCKDNS_TOKEN=""

"$REPOSITORY_DIR/infra/duckdns-update.sh" --secret-file "$SECRET_FILE"

cp -- "$PLIST_TEMPLATE" "$PLIST_TEMP"
/usr/bin/plutil -replace ProgramArguments.0 -string \
  "$REPOSITORY_DIR/infra/duckdns-update.sh" "$PLIST_TEMP"
/usr/bin/plutil -replace ProgramArguments.2 -string "$SECRET_FILE" "$PLIST_TEMP"
/usr/bin/plutil -replace WorkingDirectory -string "$REPOSITORY_DIR" "$PLIST_TEMP"
/usr/bin/plutil -replace StandardOutPath -string \
  "$LOG_DIR/duckdns-update.log" "$PLIST_TEMP"
/usr/bin/plutil -replace StandardErrorPath -string \
  "$LOG_DIR/duckdns-update-error.log" "$PLIST_TEMP"
/usr/bin/plutil -lint "$PLIST_TEMP" >/dev/null
chmod 600 "$PLIST_TEMP"
mv -f -- "$PLIST_TEMP" "$PLIST_TARGET"

/bin/launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$(id -u)" "$PLIST_TARGET"
/bin/launchctl kickstart -k "gui/$(id -u)/$LABEL"

printf 'DuckDNS updater installed domain=%s.duckdns.org interval=300s\n' "$DOMAIN"

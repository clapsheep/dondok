#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

SECRET_FILE="${HOME}/.config/dondok/duckdns.env"

usage() {
  printf '%s\n' 'Usage: infra/duckdns-update.sh [--secret-file PATH]'
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --secret-file)
      [[ $# -ge 2 ]] || fail '--secret-file requires a value'
      SECRET_FILE="$2"
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

[[ "$SECRET_FILE" == /* ]] || fail 'secret file must be an absolute path'
[[ -f "$SECRET_FILE" && ! -L "$SECRET_FILE" && -O "$SECRET_FILE" ]] \
  || fail 'secret file must be a regular, non-linked file owned by the current user'

file_mode() {
  case "$(uname -s)" in
    Darwin)
      stat -f '%Lp' "$1"
      ;;
    Linux)
      stat -c '%a' "$1"
      ;;
    *)
      fail 'unsupported operating system for secret permission checks'
      ;;
  esac
}

SECRET_MODE="$(file_mode "$SECRET_FILE")"
SECRET_MODE="${SECRET_MODE#0}"
(( (8#$SECRET_MODE & 077) == 0 )) \
  || fail 'secret file must not be accessible by group or others'

DUCKDNS_DOMAIN=""
DUCKDNS_TOKEN=""

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" == *=* ]] || fail 'secret file contains an invalid line'
  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    DUCKDNS_DOMAIN)
      [[ -z "$DUCKDNS_DOMAIN" ]] || fail 'DUCKDNS_DOMAIN is duplicated'
      DUCKDNS_DOMAIN="$value"
      ;;
    DUCKDNS_TOKEN)
      [[ -z "$DUCKDNS_TOKEN" ]] || fail 'DUCKDNS_TOKEN is duplicated'
      DUCKDNS_TOKEN="$value"
      ;;
    *)
      fail "unsupported secret key: $key"
      ;;
  esac
done < "$SECRET_FILE"

[[ "$DUCKDNS_DOMAIN" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] \
  || fail 'DUCKDNS_DOMAIN must be a single lowercase DuckDNS subdomain'
[[ "$DUCKDNS_TOKEN" =~ ^[A-Za-z0-9-]{20,128}$ ]] \
  || fail 'DUCKDNS_TOKEN has an invalid format'

CURL_BIN="${DONDOK_DUCKDNS_CURL_BIN:-$(command -v curl || true)}"
[[ "$CURL_BIN" == /* && -x "$CURL_BIN" ]] || fail 'curl is required'

RESPONSE="$(
  printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\n' \
    "$DUCKDNS_DOMAIN" "$DUCKDNS_TOKEN" \
    | "$CURL_BIN" --fail --silent --show-error --connect-timeout 10 --max-time 30 --config -
)" || fail 'DuckDNS update request failed'

RESPONSE="${RESPONSE//$'\r'/}"
[[ "$RESPONSE" == 'OK' ]] || fail 'DuckDNS rejected the update request'

printf 'DuckDNS update succeeded domain=%s.duckdns.org at=%s\n' \
  "$DUCKDNS_DOMAIN" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

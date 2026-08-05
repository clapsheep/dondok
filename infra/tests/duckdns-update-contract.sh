#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_DIR="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dondok-duckdns-test.XXXXXX")"
TEST_TOKEN="test-token-value-1234567890"

cleanup() {
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/bin"
chmod 700 "$TEST_ROOT" "$TEST_ROOT/bin"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -Eeuo pipefail' \
  'if [[ "$*" == *"test-token-value-1234567890"* ]]; then' \
  '  printf "token leaked through curl arguments\n" >&2' \
  '  exit 70' \
  'fi' \
  'IFS= read -r request_config' \
  'printf "%s\n" "$request_config" > "$DUCKDNS_TEST_REQUEST"' \
  'printf "%s\n" "${DUCKDNS_TEST_RESPONSE:-OK}"' \
  > "$TEST_ROOT/bin/curl"
chmod 700 "$TEST_ROOT/bin/curl"

SECRET_FILE="$TEST_ROOT/duckdns.env"
printf 'DUCKDNS_DOMAIN=dondok\nDUCKDNS_TOKEN=%s\n' "$TEST_TOKEN" > "$SECRET_FILE"
chmod 600 "$SECRET_FILE"

export PATH="$TEST_ROOT/bin:/usr/bin:/bin"
export DUCKDNS_TEST_REQUEST="$TEST_ROOT/request.txt"
export DONDOK_DUCKDNS_CURL_BIN="$TEST_ROOT/bin/curl"

SUCCESS_OUTPUT="$("$REPOSITORY_DIR/infra/duckdns-update.sh" --secret-file "$SECRET_FILE")"
[[ "$SUCCESS_OUTPUT" == *'domain=dondok.duckdns.org'* ]]
[[ "$SUCCESS_OUTPUT" != *"$TEST_TOKEN"* ]]
grep -Fq 'domains=dondok' "$DUCKDNS_TEST_REQUEST"
grep -Fq "token=$TEST_TOKEN" "$DUCKDNS_TEST_REQUEST"

export DUCKDNS_TEST_RESPONSE=KO
if "$REPOSITORY_DIR/infra/duckdns-update.sh" --secret-file "$SECRET_FILE" \
  > "$TEST_ROOT/rejected.out" 2> "$TEST_ROOT/rejected.err"; then
  printf 'ERROR: DuckDNS KO response was accepted\n' >&2
  exit 1
fi
! grep -Fq "$TEST_TOKEN" "$TEST_ROOT/rejected.out"
! grep -Fq "$TEST_TOKEN" "$TEST_ROOT/rejected.err"

chmod 640 "$SECRET_FILE"
if "$REPOSITORY_DIR/infra/duckdns-update.sh" --secret-file "$SECRET_FILE" \
  > "$TEST_ROOT/mode.out" 2> "$TEST_ROOT/mode.err"; then
  printf 'ERROR: group-readable DuckDNS secret was accepted\n' >&2
  exit 1
fi
grep -Fq 'must not be accessible by group or others' "$TEST_ROOT/mode.err"
! grep -Fq "$TEST_TOKEN" "$TEST_ROOT/mode.err"

printf 'DuckDNS update contracts passed\n'

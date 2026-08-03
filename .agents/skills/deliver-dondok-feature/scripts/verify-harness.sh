#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

required=(
  "AGENTS.md"
  ".gitignore"
  ".env.example"
  "skills-lock.json"
  "docs/project-context.md"
  "docs/quality/qc-strategy.md"
  "docs/operations/repository-and-deployment.md"
  ".agents/skills/deliver-dondok-feature/SKILL.md"
)

for path in "${required[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "ERROR: required harness file is missing: $path" >&2
    exit 1
  fi
done

for candidate in .env backend/.env.local frontend/.env.production secrets/example.key; do
  if ! git check-ignore --quiet --no-index "$candidate"; then
    echo "ERROR: sensitive path is not ignored: $candidate" >&2
    exit 1
  fi
done

while IFS= read -r path; do
  base="${path##*/}"
  case "$base" in
    .env|.env.*)
      if [[ "$base" != ".env.example" ]]; then
        echo "ERROR: environment file would be committed: $path" >&2
        exit 1
      fi
      ;;
    *.pem|*.key|*.p12|*.pfx|*.jks|*.keystore)
      echo "ERROR: key material would be committed: $path" >&2
      exit 1
      ;;
  esac
done < <(git ls-files --cached --others --exclude-standard)

git diff --check

if command -v xmllint >/dev/null 2>&1; then
  while IFS= read -r -d '' svg; do
    xmllint --noout "$svg"
  done < <(find design -type f -name '*.svg' -print0 2>/dev/null)
fi

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks dir --redact --no-banner .
elif [[ "${REQUIRE_GITLEAKS:-0}" == "1" ]]; then
  echo "ERROR: gitleaks is required but not installed" >&2
  exit 1
else
  echo "WARN: gitleaks is not installed; filename and ignore checks only" >&2
fi

echo "AI harness checks passed"

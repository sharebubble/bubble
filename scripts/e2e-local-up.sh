#!/usr/bin/env bash
# Bring up a local Bubble deployment (docker compose), seed it with realistic
# demo content and — optionally — the E2E multi-user pool, and point e2e/.env
# at it. Meant as the one-command base for running the Playwright suite
# locally: after this script succeeds, `cd e2e && npm ci && npm run
# test:smoke` (or `npm test`) targets the stack it just built.
#
# Usage:
#   scripts/e2e-local-up.sh [options]
#
# Options:
#   --reset            Wipe existing containers/volumes first (fresh DB).
#   --no-build         Skip `--build` (faster re-runs once images exist).
#   --no-seed-demo     Skip `manage.py seed_demo` (rich browse/booking content).
#   --no-seed-e2e-pool Skip provisioning the E2E_* user pool used by
#                       @regression specs (owner/renterA/renterB/admin).
#   --timeout SECONDS  Max time to wait for the stack to become healthy
#                       (default: 180).
#   -h, --help         Show this help.
#
# Safe to re-run: docker compose up is idempotent, seed_demo is idempotent,
# and the E2E pool is only (re)generated for env vars not already set.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Respect the same COMPOSE_FILE convention as the justfile: layer in
# compose.override.yaml when present, but don't clobber a value the caller
# (e.g. CI, which layers compose.test.yaml) already exported.
if [ -z "${COMPOSE_FILE:-}" ] && [ -f compose.override.yaml ]; then
  export COMPOSE_FILE="compose.yaml:compose.override.yaml"
fi

RESET=0
BUILD_FLAG="--build"
SEED_DEMO=1
SEED_E2E_POOL=1
TIMEOUT=180
BASE_URL="${E2E_BASE_URL:-http://localhost:8080}"

while [ $# -gt 0 ]; do
  case "$1" in
    --reset) RESET=1 ;;
    --no-build) BUILD_FLAG="" ;;
    --no-seed-demo) SEED_DEMO=0 ;;
    --no-seed-e2e-pool) SEED_E2E_POOL=0 ;;
    --timeout)
      shift
      TIMEOUT="${1:?--timeout requires a value}"
      ;;
    -h|--help)
      sed -n '2,25p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

log() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1" >&2; }

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but was not found on PATH." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required (used for the readiness check) but was not found on PATH." >&2
  exit 1
fi

if [ "$RESET" -eq 1 ]; then
  log "Resetting stack (down -v)"
  docker compose down -v --remove-orphans
fi

log "Starting containers (docker compose up -d ${BUILD_FLAG})"
# shellcheck disable=SC2086 # BUILD_FLAG is an intentional optional word-split flag
docker compose up -d --remove-orphans ${BUILD_FLAG}

log "Waiting for the stack to become healthy (timeout ${TIMEOUT}s)"
elapsed=0
until curl -fsS -o /dev/null "${BASE_URL}/api/version/" 2>/dev/null; do
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    warn "Timed out waiting for ${BASE_URL}/api/version/ — recent logs:"
    docker compose logs --tail=50 backend frontend
    exit 1
  fi
  sleep 3
  elapsed=$((elapsed + 3))
done
log "Backend is up (${BASE_URL}/api/version/ responded after ${elapsed}s)"

log "Applying migrations"
docker compose exec -T backend python manage.py migrate --noinput

if [ "$SEED_DEMO" -eq 1 ]; then
  log "Seeding demo content (users, items, bookings, collections)"
  docker compose exec -T backend python manage.py seed_demo
else
  warn "Skipping seed_demo (--no-seed-demo)"
fi

# -- E2E multi-user pool ------------------------------------------------------
# The Playwright suite's @regression specs need a pool of real, credentialed
# users (owner/renterA/renterB/admin — see e2e/support/config.ts ROLES).
# If e2e/.env doesn't have them yet, generate random per-role passwords so the
# suite is runnable out of the box; never overwrite credentials that are
# already configured.

ROLES=(OWNER RENTERA RENTERB ADMIN)
E2E_ENV_FILE="e2e/.env"

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 16
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Set KEY=VALUE in FILE: replaces an existing `KEY=...` line (any value,
# including empty), or appends the line if the key isn't present at all —
# unlike a bare `sed` replace, this also handles a hand-edited .env that's
# missing a key outright.
set_env_var() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i.bak "s#^${key}=.*#${key}=${value}#" "$file" && rm -f "${file}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

# Same, but only when KEY isn't already set to a non-empty value — for
# credentials we generate once and never want to overwrite.
set_env_var_if_unset() {
  local file="$1" key="$2" value="$3"
  grep -q "^${key}=.\+" "$file" 2>/dev/null && return 0
  set_env_var "$file" "$key" "$value"
}

if [ "$SEED_E2E_POOL" -eq 1 ]; then
  log "Provisioning the E2E user pool"

  if [ ! -f "$E2E_ENV_FILE" ]; then
    cp e2e/.env.example "$E2E_ENV_FILE"
  fi

  # Always point the suite at the stack this run just started — e2e/.env.example
  # ships E2E_BASE_URL defaulted to stage, so an "only if unset" check would
  # never fire and silently leave tests pointed at stage after a fresh copy.
  set_env_var "$E2E_ENV_FILE" E2E_BASE_URL "$BASE_URL"

  for role in "${ROLES[@]}"; do
    username="e2e-$(echo "$role" | tr '[:upper:]' '[:lower:]')"
    set_env_var_if_unset "$E2E_ENV_FILE" "E2E_${role}_USERNAME" "$username"
    set_env_var_if_unset "$E2E_ENV_FILE" "E2E_${role}_PASSWORD" "$(random_secret)"
  done

  # Load the (now fully populated) pool credentials and hand them to seed_e2e
  # inside the running backend container.
  set -a
  # shellcheck disable=SC1090
  source "$E2E_ENV_FILE"
  set +a

  env_args=(-e E2E_ALLOW=1)
  for role in "${ROLES[@]}"; do
    for suffix in USERNAME PASSWORD; do
      key="E2E_${role}_${suffix}"
      value="${!key:-}"
      [ -n "$value" ] && env_args+=(-e "${key}=${value}")
    done
  done

  docker compose exec -T "${env_args[@]}" backend python manage.py seed_e2e
  log "E2E pool ready — credentials written to ${E2E_ENV_FILE} (git-ignored)"
else
  warn "Skipping E2E user pool provisioning (--no-seed-e2e-pool)"
fi

log "Stack ready"
cat <<SUMMARY

  Frontend:       ${BASE_URL}
  API:            ${BASE_URL}/api/
  Django admin:   ${BASE_URL}/admin/

  Demo login:     demo / demodemo   (also: anna / demodemo, ben / demodemo)

  Run the E2E suite against this stack:
    cd e2e && npm ci
    E2E_BASE_URL=${BASE_URL} npm run test:smoke
    E2E_BASE_URL=${BASE_URL} npm test   # full suite, needs the pool seeded above

  Tear down:
    docker compose down          # keep data
    docker compose down -v       # wipe data too

SUMMARY

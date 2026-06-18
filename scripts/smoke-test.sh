#!/usr/bin/env bash
# School Kit — staging smoke test
#
# Usage:
#   SMOKE_API_URL=https://school-kit-api.fly.dev bash scripts/smoke-test.sh
#
# Five ops:
#   1. GET  /api/v1/health             → 200
#   2. GET  /api/v1/health/db          → 200, role == "app_user"
#   3. POST /api/v1/auth/signup-owner  → 201 (timestamp-suffixed smoke school)
#   4. POST /api/v1/auth/login         → 200, body contains .token
#   5. GET  /api/v1/schools/me         → 200, body.slug == smoke school slug
#
# Any failure exits non-zero. The deploy workflow auto-rolls back on failure.
# Smoke schools (slug pattern: smoke-<unix-timestamp>) accumulate in staging.
# Clean them with:  pnpm db:prune-smoke   (see scripts/prune-smoke-schools.sql)

set -euo pipefail

BASE="${SMOKE_API_URL:?SMOKE_API_URL env var must be set}"
TIMESTAMP=$(date +%s)
SLUG="smoke-${TIMESTAMP}"
EMAIL="smoke-${TIMESTAMP}@smoke-test.invalid"
PASSWORD="SmokeTest1234"

fail() {
  echo "SMOKE FAIL [$1]: $2" >&2
  exit 1
}

echo "Running smoke test against ${BASE}"
echo "  Smoke school slug: ${SLUG}"
echo ""

# ── Op 1: basic health ──────────────────────────────────────────────────────
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/api/v1/health")
[[ "${STATUS}" == "200" ]] || fail "op 1" "GET /health expected 200, got ${STATUS}"
echo "[OK] op 1 — GET /health → 200"

# ── Op 2: DB health + runtime role check ────────────────────────────────────
DB_RESP=$(curl -s -w "\n%{http_code}" "${BASE}/api/v1/health/db")
DB_BODY=$(printf '%s' "${DB_RESP}" | head -n -1)
DB_STATUS=$(printf '%s' "${DB_RESP}" | tail -n 1)
[[ "${DB_STATUS}" == "200" ]] || fail "op 2" "GET /health/db expected 200, got ${DB_STATUS} — body: ${DB_BODY}"
DB_ROLE=$(printf '%s' "${DB_BODY}" | jq -r '.role // empty')
[[ "${DB_ROLE}" == "app_user" ]] || fail "op 2" "DB role is '${DB_ROLE}', expected 'app_user' — RLS bypass risk"
echo "[OK] op 2 — GET /health/db → 200 (role=app_user)"

# ── Op 3: owner signup ───────────────────────────────────────────────────────
SIGNUP_RESP=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/v1/auth/signup-owner" \
  -H "Content-Type: application/json" \
  -d "{
    \"schoolName\": \"Smoke Test School ${TIMESTAMP}\",
    \"schoolSlug\": \"${SLUG}\",
    \"ownerFirstName\": \"Smoke\",
    \"ownerLastName\": \"Test\",
    \"ownerEmail\": \"${EMAIL}\",
    \"ownerPhone\": \"08000000000\",
    \"password\": \"${PASSWORD}\",
    \"ndprConsent\": true
  }")
SIGNUP_BODY=$(printf '%s' "${SIGNUP_RESP}" | head -n -1)
SIGNUP_STATUS=$(printf '%s' "${SIGNUP_RESP}" | tail -n 1)
[[ "${SIGNUP_STATUS}" == "201" ]] || fail "op 3" "signup expected 201, got ${SIGNUP_STATUS} — body: ${SIGNUP_BODY}"
echo "[OK] op 3 — POST /auth/signup-owner → 201"

# ── Op 4: login ──────────────────────────────────────────────────────────────
LOGIN_RESP=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"${EMAIL}\", \"password\": \"${PASSWORD}\"}")
LOGIN_BODY=$(printf '%s' "${LOGIN_RESP}" | head -n -1)
LOGIN_STATUS=$(printf '%s' "${LOGIN_RESP}" | tail -n 1)
[[ "${LOGIN_STATUS}" == "200" ]] || fail "op 4" "login expected 200, got ${LOGIN_STATUS} — body: ${LOGIN_BODY}"
TOKEN=$(printf '%s' "${LOGIN_BODY}" | jq -r '.token // empty')
[[ -n "${TOKEN}" ]] || fail "op 4" "login response missing .token — body: ${LOGIN_BODY}"
echo "[OK] op 4 — POST /auth/login → 200 (token received)"

# ── Op 5: /schools/me ────────────────────────────────────────────────────────
SCHOOL_RESP=$(curl -s -w "\n%{http_code}" "${BASE}/api/v1/schools/me" \
  -H "Authorization: Bearer ${TOKEN}")
SCHOOL_BODY=$(printf '%s' "${SCHOOL_RESP}" | head -n -1)
SCHOOL_STATUS=$(printf '%s' "${SCHOOL_RESP}" | tail -n 1)
[[ "${SCHOOL_STATUS}" == "200" ]] || fail "op 5" "/schools/me expected 200, got ${SCHOOL_STATUS} — body: ${SCHOOL_BODY}"
RETURNED_SLUG=$(printf '%s' "${SCHOOL_BODY}" | jq -r '.slug // empty')
[[ "${RETURNED_SLUG}" == "${SLUG}" ]] || fail "op 5" "slug mismatch — expected '${SLUG}', got '${RETURNED_SLUG}'"
echo "[OK] op 5 — GET /schools/me → 200 (slug=${RETURNED_SLUG})"

echo ""
echo "Smoke test passed (5/5 ops). Smoke school: ${SLUG}"

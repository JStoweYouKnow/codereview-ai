#!/bin/bash
# Hackathon evaluation script - tests production site against judge checklist
# Usage: ./scripts/hackathon-eval.sh <BASE_URL>

BASE_URL="${1:?Usage: $0 <BASE_URL>}"
BASE_URL="${BASE_URL%/}"

echo "=== CodeReview AI Hackathon Evaluation ==="
echo "Base URL: $BASE_URL"
echo ""

PASS=0
FAIL=0

check() {
  local desc="$1"
  shift
  if "$@" 2>/dev/null; then
    echo "✅ $desc"
    ((PASS++)) || true
  else
    echo "❌ $desc"
    ((FAIL++)) || true
  fi
}

# 1. Dashboard loads
check "Dashboard loads" curl -sf -o /dev/null -w "" "$BASE_URL/"

# 2. Health endpoint
check "Health endpoint" curl -sf "$BASE_URL/health" -o /dev/null

# 3. API status (Gradient AI readiness)
STATUS=$(curl -sf "$BASE_URL/api/status" 2>/dev/null || echo "{}")
if echo "$STATUS" | grep -q '"configured":true'; then
  echo "✅ API status: AI Ready"
  ((PASS++)) || true
else
  echo "❌ API status: AI Demo (Gradient not configured or unreachable)"
  ((FAIL++)) || true
fi

# 4. Generate demo data
SEED_RES=$(curl -sf -X POST "$BASE_URL/api/demo/seed" 2>/dev/null || echo "")
if echo "$SEED_RES" | grep -q '"message"'; then
  echo "✅ Generate demo data: Created"
  ((PASS++)) || true
else
  echo "❌ Generate demo data: Failed"
  ((FAIL++)) || true
fi

# 5. Reviews endpoint
REVIEWS=$(curl -sf "$BASE_URL/api/reviews?limit=5" 2>/dev/null || echo "{}")
if echo "$REVIEWS" | grep -q '"items"'; then
  echo "✅ Reviews API: Returns data"
  ((PASS++)) || true
else
  echo "❌ Reviews API: Failed or empty"
  ((FAIL++)) || true
fi

# 6. Stats endpoint
check "Stats API" curl -sf "$BASE_URL/api/stats" -o /dev/null

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

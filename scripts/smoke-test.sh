#!/usr/bin/env bash
# End-to-end API check for a running stack (needs only bash + curl).
set -u
BASE="${BASE_URL:-http://localhost:8080}"
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
PASS=0; FAIL=0
U="smoke$(date +%s)"; EMAIL="$U@example.com"; PW1="first-password-1"; PW2="second-password-2"
STATUS=""; BODY=""

req() { # req METHOD PATH [JSON]  -> STATUS, BODY
  local out
  if [ $# -ge 3 ]; then
    out=$(curl -s -m 25 -b "$JAR" -c "$JAR" -X "$1" "$BASE$2" -H 'Content-Type: application/json' -d "$3" -w $'\n%{http_code}')
  else
    out=$(curl -s -m 25 -b "$JAR" -c "$JAR" -X "$1" "$BASE$2" -w $'\n%{http_code}')
  fi
  STATUS="${out##*$'\n'}"; BODY="${out%$'\n'*}"
}
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n         status=%s body=%s\n' "$1" "$STATUS" "${BODY:0:200}"; }
expect() { # expect "description" STATUS [substring]
  if [ "$STATUS" = "$2" ] && { [ -z "${3:-}" ] || [[ "$BODY" == *"$3"* ]]; }; then ok "$1"; else bad "$1"; fi
}

echo "Testing $BASE"
echo "[health]"
req GET /api/health;  expect "liveness answers 200" 200 '"ok"'
req GET /api/ready;   expect "readiness answers 200 (DB reachable)" 200 '"ready"'

echo "[auth: signed out]"
req GET /api/auth/me;           expect "/auth/me is 401 without a session" 401
req GET "/api/weather?q=Cairo"; expect "weather is 401 without a session" 401

echo "[auth: register]"
req POST /api/auth/register "{\"username\":\"$U\",\"email\":\"$EMAIL\",\"password\":\"short\"}"
expect "short password rejected" 400
req POST /api/auth/register "{\"username\":\"a@b\",\"email\":\"$EMAIL\",\"password\":\"$PW1\"}"
expect "invalid username rejected" 400
req POST /api/auth/register "{\"username\":\"$U\",\"email\":\"$EMAIL\",\"password\":\"$PW1\"}"
expect "register succeeds and signs in" 201 "\"username\":\"$U\""
grep -q wa_session "$JAR" && ok "session cookie is set" || bad "session cookie is set"
grep -q "#HttpOnly_" "$JAR" && ok "cookie is HttpOnly" || bad "cookie is HttpOnly"
req POST /api/auth/register "{\"username\":\"${U}x\",\"email\":\"$EMAIL\",\"password\":\"$PW1\"}"
expect "duplicate email rejected" 409 email_taken
req POST /api/auth/register "{\"username\":\"$U\",\"email\":\"other-$EMAIL\",\"password\":\"$PW1\"}"
expect "duplicate username rejected" 409 username_taken
req GET /api/auth/me;           expect "/auth/me returns the user" 200 "\"email\":\"$EMAIL\""

echo "[weather via Open-Meteo]"
req GET "/api/places/search?q=Alex&limit=5"; expect "autocomplete returns matching places" 200 '"results":['
req GET "/api/weather?q=London&track=false"; expect "track=false fetches weather without recording history" 200 '"hourly":['
req GET /api/places;                         expect "recent searches still empty after track=false" 200 '"recent":[]'

req GET "/api/weather?q=Cairo"; expect "city search returns weather" 200 '"current"'
DAYS=$(grep -o '"date"' <<<"$BODY" | wc -l | tr -d ' ')
[ "$DAYS" = "7" ] && ok "forecast has 7 days" || { STATUS="days=$DAYS"; bad "forecast has 7 days"; }
PLACE_ID=$(sed -n 's/.*"place":{"id":\([0-9]*\).*/\1/p' <<<"$BODY")
[ -n "$PLACE_ID" ] && ok "place id extracted ($PLACE_ID)" || bad "place id extracted"
req GET "/api/weather?q=Zzzzqqqxx"; expect "unknown city gives 404 city_not_found" 404 city_not_found
req GET "/api/weather?q=";          expect "empty search gives 400" 400
req GET "/api/world";               expect "world weather returns stations with timezone" 200 '"timezone"'
req GET "/api/weather?id=$PLACE_ID"; expect "weather by saved/recent place id" 200 '"daily"'
req GET "/api/weather?id=999999999"; expect "unknown place id gives 404" 404

echo "[places]"
req GET /api/places;                expect "recent searches contain the search" 200 '"recent":[{'
req POST /api/favorites "{\"placeId\":$PLACE_ID}"; expect "add favorite" 201
req GET /api/places;                expect "favorite is listed" 200 '"favorites":[{'
req POST /api/favorites '{"placeId":999999999}';   expect "cannot favorite an unverified place" 404
req DELETE "/api/favorites/$PLACE_ID";             expect "remove favorite" 204
req GET /api/places;                expect "favorites empty again" 200 '"favorites":[]'

echo "[settings]"
req PATCH /api/me/preferences '{"temperatureUnit":"F"}'; expect "switch to Fahrenheit" 200 '"F"'
req GET /api/auth/me;           expect "unit persisted on the account" 200 '"temperatureUnit":"F"'
req PATCH /api/me/preferences '{"temperatureUnit":"K"}'; expect "invalid unit rejected" 400
req PATCH /api/me "{\"username\":\"$U\",\"email\":\"changed-$EMAIL\"}"
expect "changing email needs the current password" 400 current_password_required
req PATCH /api/me "{\"username\":\"$U\",\"email\":\"changed-$EMAIL\",\"currentPassword\":\"wrong-password\"}"
expect "wrong current password is 403 (not 401)" 403 wrong_password
req PATCH /api/me "{\"username\":\"$U\",\"email\":\"$EMAIL\",\"currentPassword\":\"$PW1\",\"newPassword\":\"$PW2\"}"
expect "password change succeeds" 200

echo "[security]"
req POST /api/auth/logout;      expect "logout" 204
req GET /api/auth/me;           expect "session is revoked after logout" 401
OUT=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -H 'Origin: http://evil.example' -d "{\"identifier\":\"$U\",\"password\":\"$PW2\"}")
[ "$OUT" = "403" ] && ok "cross-origin POST is blocked" || { STATUS=$OUT; bad "cross-origin POST is blocked"; }
req POST /api/auth/login "{\"identifier\":\"$U\",\"password\":\"$PW1\"}"; expect "old password no longer works" 401 invalid_credentials
req POST /api/auth/login "{\"identifier\":\"$U\",\"password\":\"$PW2\"}"; expect "login with username + new password" 200
req POST /api/auth/logout
req POST /api/auth/login "{\"identifier\":\"$(tr 'A-Z' 'a-z' <<<"$EMAIL")\",\"password\":\"$PW2\"}"; expect "login with email" 200
req POST /api/auth/logout

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
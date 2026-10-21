#!/usr/bin/env bash
# Disposable server-only PostgreSQL regression. No production DB or credentials.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$REPO/supabase/migrations/20261021155044_writer_lease_fencing_v1.sql"
APPROVAL="$REPO/supabase/migrations/20261021173010_trusted_task_approval_gate_v1.sql"
DEVICE="$REPO/supabase/migrations/20261021190119_device_trust_and_approval_nonce_v1.sql"
for f in "$BASE" "$APPROVAL" "$DEVICE"; do test -f "$f"; done
for tool in initdb pg_ctl psql uuidgen; do command -v "$tool" >/dev/null || exit 2; done
QA="$(mktemp -d "${TMPDIR:-/tmp}/katosync-device-qa.XXXXXX")"
mkdir -p "$QA/socket"
cleanup(){
 if [[ -f "$QA/pgdata/postmaster.pid" ]]; then
  pg_ctl -D "$QA/pgdata" -m immediate -w stop >/dev/null 2>&1 || true
 fi
 rm -rf -- "$QA"
}
trap cleanup EXIT
initdb -D "$QA/pgdata" -U postgres -A trust --no-instructions > "$QA/init.log"
pg_ctl -D "$QA/pgdata" -o "-h '' -k $QA/socket -p 55489" -l "$QA/postgres.log" -w start >/dev/null
export PGHOST="$QA/socket" PGPORT=55489 PGUSER=postgres PGDATABASE=postgres
psql -X -q -v ON_ERROR_STOP=1 -c 'CREATE ROLE service_role BYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated;' >/dev/null
for migration in "$BASE" "$APPROVAL" "$DEVICE"; do
 psql -X -q -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done
psql -X -q -v ON_ERROR_STOP=1 -f "$REPO/tests/device-trust-and-nonce.sql"
ACCOUNT='11111111-1111-4111-8111-111111111111'
OWNER='22222222-2222-4222-8222-222222222222'
SESSION='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
SIGNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
WORKER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
TASK='ffffffff-ffff-4fff-8fff-ffffffffffff'
# 12 separate challenges in different projects, both sessions race against
# the SAME challenge in each iteration: exactly one UPDATE RETURNING succeeds.
for i in $(seq 1 12); do
  CHALLENGE="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  PROJECT="nonce-race-$i"
  psql -X -q -v ON_ERROR_STOP=1 -c "
    SET ROLE service_role;
    INSERT INTO katosync_private.approval_challenges
    (challenge_id,nonce,account_id,project_id,task_id,executor_device_id,
    approver_device_id,expected_head,scope,user_id,session_id,expires_at)
    VALUES ('$CHALLENGE',repeat('a',42)||chr(65+$i),'$ACCOUNT','$PROJECT',
    '$TASK','$WORKER','$SIGNER',repeat('a',40),'edit_worktree',
    '$OWNER','$SESSION',clock_timestamp()+interval '60 seconds');" >/dev/null
  psql -X -qAt -v ON_ERROR_STOP=1 -c "
    SET ROLE service_role;
    SELECT count(*) FROM katosync_private.consume_approval_challenge(
    '$CHALLENGE','$OWNER','$SESSION');" > "$QA/result_a" &
  A=$!
  psql -X -qAt -v ON_ERROR_STOP=1 -c "
    SET ROLE service_role;
    SELECT count(*) FROM katosync_private.consume_approval_challenge(
    '$CHALLENGE','$OWNER','$SESSION');" > "$QA/result_b" &
  B=$!
  wait "$A"; wait "$B"
  AA="$(tail -n 1 "$QA/result_a" | tr -d '\r')"
  BB="$(tail -n 1 "$QA/result_b" | tr -d '\r')"
  if [[ "$AA" != '1' || "$BB" != '0' ]] && [[ "$AA" != '0' || "$BB" != '1' ]]; then
    echo "FAIL nonce race $i: [$AA] [$BB]" >&2; exit 1
  fi
done
echo "PASS: membership/device immutability, private ACL, replay and 12 atomic dual-consumer races."

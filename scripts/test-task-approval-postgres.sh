#!/usr/bin/env bash
# KatoSync #76: synthetic private task approval + fenced lease regression.
# NEVER USE AGAINST A LIVE DB. No cloud credentials, no TCP listeners.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$REPO/supabase/migrations/20261021155044_writer_lease_fencing_v1.sql"
GATE="$REPO/supabase/migrations/20261021173010_trusted_task_approval_gate_v1.sql"
test -f "$BASE" && test -f "$GATE" || { echo "Missing migrations" >&2; exit 2; }
for tool in initdb pg_ctl psql uuidgen; do
  command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 2; }
done
QA="$(mktemp -d "${TMPDIR:-/tmp}/katosync-approval-qa.XXXXXX")"
mkdir -p "$QA/socket"
cleanup() {
  if [[ -f "$QA/pgdata/postmaster.pid" ]]; then
    pg_ctl -D "$QA/pgdata" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$QA"
}
trap cleanup EXIT

initdb -D "$QA/pgdata" -U postgres -A trust --no-instructions > "$QA/init.log"
pg_ctl -D "$QA/pgdata" -o "-h '' -k $QA/socket -p 55488" -l "$QA/postgres.log" -w start >/dev/null
export PGHOST="$QA/socket" PGPORT=55488 PGUSER=postgres PGDATABASE=postgres
psql -X -v ON_ERROR_STOP=1 -q -c 'CREATE ROLE service_role BYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated;' >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f "$BASE"
psql -X -v ON_ERROR_STOP=1 -q -f "$GATE"
psql -X -v ON_ERROR_STOP=1 -q -f "$REPO/tests/trusted-task-approval.sql"

ACCOUNT='11111111-1111-4111-8111-111111111111'
DEV_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
DEV_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
TASK_A='11111111-aaaa-4111-8111-111111111111'
TASK_B='22222222-bbbb-4222-8222-222222222222'
APPROVER='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

# Twelve independent backend-eligible competing nodes, using TWO valid
# task approvals for the SAME project. Exactly one must get an active lease.
for i in $(seq 1 12); do
  PROJECT="approved-race-$i"
  A="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  B="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  psql -X -v ON_ERROR_STOP=1 -q -c "
    SET ROLE service_role;
    INSERT INTO katosync_private.task_approvals
      (approval_id,account_id,project_id,device_id,task_id,expected_head,
       approved_by,proof_digest_sha256,capabilities,expires_at)
    VALUES
      ('$A','$ACCOUNT','$PROJECT','$DEV_A','$TASK_A','$SHA','$APPROVER',
       repeat('a',64),ARRAY['edit_worktree'],clock_timestamp()+interval '30 minutes'),
      ('$B','$ACCOUNT','$PROJECT','$DEV_B','$TASK_B','$SHA','$APPROVER',
       repeat('b',64),ARRAY['edit_worktree'],clock_timestamp()+interval '30 minutes');
  " >/dev/null
  psql -X -qAt -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT acquired FROM katosync_private.acquire_writer_lease('$ACCOUNT','$PROJECT','$DEV_A','$TASK_A','$A','$SHA',60);" > "$QA/result_a" &
  PID_A=$!
  psql -X -qAt -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT acquired FROM katosync_private.acquire_writer_lease('$ACCOUNT','$PROJECT','$DEV_B','$TASK_B','$B','$SHA',60);" > "$QA/result_b" &
  PID_B=$!
  wait "$PID_A"
  wait "$PID_B"
  OUT_A="$(tail -n 1 "$QA/result_a" | tr -d '\r')"
  OUT_B="$(tail -n 1 "$QA/result_b" | tr -d '\r')"
  if [[ "$OUT_A" != 't' && "$OUT_A" != 'f' ]] || [[ "$OUT_B" != 't' && "$OUT_B" != 'f' ]] || [[ "$OUT_A" == "$OUT_B" ]]; then
    echo "FAIL approved race $i: [$OUT_A]/[$OUT_B]" >&2
    exit 1
  fi
done
# Race a valid acquisition against revocation of THAT SAME approval.
# After both transactions settle, neither a stale lease nor re-acquire is valid.
for i in $(seq 1 8); do
  PROJECT="revoke-race-$i"
  APPROVAL="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  psql -X -q -v ON_ERROR_STOP=1 -c "
    SET ROLE service_role;
    INSERT INTO katosync_private.task_approvals
      (approval_id,account_id,project_id,device_id,task_id,expected_head,
       approved_by,proof_digest_sha256,capabilities,expires_at)
    VALUES ('$APPROVAL','$ACCOUNT','$PROJECT','$DEV_A','$TASK_A','$SHA',
       '$APPROVER',repeat('c',64),ARRAY['edit_worktree'],
       clock_timestamp()+interval '30 minutes');" >/dev/null

  psql -X -qAt -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT acquired FROM katosync_private.acquire_writer_lease('$ACCOUNT','$PROJECT','$DEV_A','$TASK_A','$APPROVAL','$SHA',60);" >"$QA/claim_revoke" &
  PID_C=$!
  psql -X -qAt -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT katosync_private.revoke_task_approval('$ACCOUNT','$APPROVAL');" >"$QA/revoke_claim" &
  PID_R=$!
  wait "$PID_C"
  wait "$PID_R"
  [[ "$(tail -n 1 "$QA/revoke_claim")" == "t" ]] || { echo "Revocation failed during race" >&2; exit 1; }

  ACTIVE="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "
    SET ROLE service_role;
    SELECT count(*) FROM katosync_private.writer_leases wl
    JOIN katosync_private.task_approvals ap ON ap.approval_id=wl.approval_id
    WHERE wl.account_id='$ACCOUNT' AND wl.project_id='$PROJECT'
      AND ap.revoked_at IS NULL AND ap.expires_at>clock_timestamp()
      AND wl.expires_at>clock_timestamp();" | tail -n 1)"
  [[ "$ACTIVE" == "0" ]] || { echo "Lease remained valid after revocation" >&2; exit 1; }
  RETRY="$(psql -X -qAt -v ON_ERROR_STOP=1 -c "
    SET ROLE service_role;
    SELECT acquired FROM katosync_private.acquire_writer_lease('$ACCOUNT','$PROJECT','$DEV_A','$TASK_A','$APPROVAL','$SHA',60);" | tail -n 1)"
  [[ "$RETRY" == "f" ]] || { echo "Revoked grant accepted a retry" >&2; exit 1; }
done

echo "PASS: approval, revocation, ACL, 12 dual-valid-approval races and 8 revoke-vs-acquire races."
echo "Socket-only ephemeral PostgreSQL will be stopped and removed."

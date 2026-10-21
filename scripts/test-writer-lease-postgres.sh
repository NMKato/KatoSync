#!/usr/bin/env bash
# KatoSync #76: isolated, repeatable PostgreSQL writer-lease regression.
# NO production database, Supabase project, cloud credentials or TCP listener.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$(find "$REPO_ROOT/supabase/migrations" -maxdepth 1 -type f -name '*_writer_lease_fencing_v1.sql' -print -quit)"
[[ -n "$MIGRATION" && -f "$MIGRATION" ]] || { echo "Migration missing" >&2; exit 2; }
for tool in initdb pg_ctl psql; do
  command -v "$tool" >/dev/null || { echo "$tool not installed" >&2; exit 2; }
done

QA="$(mktemp -d "${TMPDIR:-/tmp}/katosync-fenced-lease.XXXXXX")"
mkdir -p "$QA/socket"
cleanup() {
  if [[ -f "$QA/pgdata/postmaster.pid" ]]; then
    pg_ctl -D "$QA/pgdata" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$QA"
}
trap cleanup EXIT

initdb -D "$QA/pgdata" -U postgres -A trust --no-instructions >"$QA/init.log"
# Socket-only: no internet/LAN exposure. Unique socket dir makes port reusable.
pg_ctl -D "$QA/pgdata" -o "-h '' -k $QA/socket -p 55479" -l "$QA/postgres.log" -w start >/dev/null
export PGHOST="$QA/socket" PGPORT=55479 PGUSER=postgres PGDATABASE=postgres
psql -X -v ON_ERROR_STOP=1 -q -c 'CREATE ROLE service_role BYPASSRLS; CREATE ROLE anon; CREATE ROLE authenticated;' >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f "$MIGRATION" >/dev/null
psql -X -v ON_ERROR_STOP=1 -q -f "$REPO_ROOT/tests/writer-lease-atomic.sql"

# Two independent database sessions race to become the one project writer.
ACCOUNT='11111111-1111-4111-8111-111111111111'
DEV_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
DEV_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
TASK_A='11111111-aaaa-4111-8111-111111111111'
TASK_B='22222222-bbbb-4222-8222-222222222222'
APPROVAL='12345678-1234-4234-8234-123456781234'
SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
for i in $(seq 1 12); do
  PROJECT="race-$i"
  psql -X -v ON_ERROR_STOP=1 -At -c "SET ROLE service_role; SELECT acquired FROM katosync_private.acquire_writer_lease('$ACCOUNT','$PROJECT','$DEV_A','$TASK_A','$APPROVAL','$SHA',60);" > "$QA/claim_a" &
  PID_A=$!
  psql -X -v ON_ERROR_STOP=1 -At -c "SET ROLE service_role; SELECT acquired FROM katosync_private.acquire_writer_lease('$ACCOUNT','$PROJECT','$DEV_B','$TASK_B','$APPROVAL','$SHA',60);" > "$QA/claim_b" &
  PID_B=$!
  wait "$PID_A"
  wait "$PID_B"
  A="$(tail -n 1 "$QA/claim_a" | tr -d '\r')"
  B="$(tail -n 1 "$QA/claim_b" | tr -d '\r')"
  if [[ "$A" != 't' && "$A" != 'f' ]] || [[ "$B" != 't' && "$B" != 'f' ]] || [[ "$A" == "$B" ]]; then
    echo "FAIL: race $i produced [$A] [$B]; expected exactly one winner" >&2
    exit 1
  fi
done

echo "PASS: sequential permissions/expiry/fence tests and 12 simultaneous two-node races."
echo "PASS: ephemeral database stopped/removed by EXIT trap."

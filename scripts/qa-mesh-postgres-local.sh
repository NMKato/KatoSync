#!/usr/bin/env bash
# Created by NMKato Solutions
# Hermetic, Unix-socket-only, disposable PostgreSQL Mesh migration audit.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${KATOSYNC_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
for exe in initdb pg_ctl psql; do
  if ! test -x "$PG_BIN/$exe"; then
    echo "MESH_QA_MISSING_LOCAL_POSTGRESQL_17: $PG_BIN/$exe" >&2; exit 2
  fi
done
# Run only on an isolated temporary PG cluster; never use external PGDATABASE
# or a remote URL. Local trust authentication is safe because the temporary
# Unix socket directory has mode 0700 and TCP listening is explicitly OFF.
DIR="$(mktemp -d /tmp/ksmeshqa.XXXXXX)"
chmod 700 "$DIR"
PORT=55439
running=0
cleanup() {
  if test "$running" -eq 1; then
    "$PG_BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf -- "$DIR"
}
trap cleanup EXIT INT TERM
"$PG_BIN/initdb" -D "$DIR/data" -A trust -U postgres --no-instructions >"$DIR/initdb.log" 2>&1
"$PG_BIN/pg_ctl" -D "$DIR/data" -l "$DIR/postgres.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='$DIR' -p $PORT" \
  -w start >"$DIR/start.log" 2>&1
running=1
# Guards enforce that the launched PG process cannot accept a TCP connection.
if "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -c 'select 1' >/dev/null 2>&1; then
  echo "MESH_QA_UNEXPECTED_TCP_LISTENER" >&2; exit 3
fi
echo "MESH_QA_EPHEMERAL_CLUSTER_ONLY"
case "${1:-legacy}" in
  legacy) TEST_FILE="$ROOT/tests/sql/mesh_registry_backend_qa.sql" ;;
  katosync) TEST_FILE="$ROOT/tests/sql/katosync_owned_schema_qa.sql" ;;
  quota-stage4e) TEST_FILE="$ROOT/tests/sql/mesh_quota_stage4e_disposable_qa.sql" ;;
  quota-stage4e-identity) TEST_FILE="$ROOT/tests/sql/mesh_quota_stage4e_identity_disposable_qa.sql" ;;
  quota-stage4e-release-candidate) TEST_FILE="$ROOT/tests/sql/mesh_stage4e_release_candidate_disposable_qa.sql" ;;
  quota-stage4e-atomic-writes) TEST_FILE="$ROOT/tests/sql/mesh_stage4e_atomic_write_disposable_qa.sql" ;;
  inbox) TEST_FILE="$ROOT/tests/sql/mesh_inbox_send_qa.sql" ;;
  inbox-receiver) TEST_FILE="$ROOT/tests/sql/mesh_inbox_receive_qa.sql" ;;
  inbox-proof) TEST_FILE="$ROOT/tests/sql/mesh_resolution_proof_qa.sql" ;;
  inbox-lifecycle) TEST_FILE="$ROOT/tests/sql/mesh_inbox_terminal_lifecycle_disposable_qa.sql" ;;
  inbox-lifecycle-localstack) TEST_FILE="$ROOT/tests/sql/mesh_inbox_terminal_lifecycle_disposable_qa.sql" ;;
  inbox-continuity) TEST_FILE="$ROOT/tests/sql/mesh_inbox_key_continuity_qa.sql" ;;
  inbox-edge-e2e) TEST_FILE="$ROOT/tests/sql/mesh_inbox_edge_e2e_setup.sql" ;;
  inbox-relay) TEST_FILE="$ROOT/tests/sql/mesh_pairing_relay_qa.sql" ;;
  shared-rollout) TEST_FILE="$ROOT/tests/sql/mesh_stage3v_shared_schema_compat.sql" ;;
  shared-beta-failclose) TEST_FILE="$ROOT/tests/sql/mesh_shared_k2s_private_beta_failclosed_qa.sql" ;;
  inbox-relay-rust-e2e) TEST_FILE="$ROOT/tests/sql/mesh_relay_stage3k_setup.sql" ;;
  *) echo "MESH_QA_UNKNOWN_TEST_SELECTION" >&2; exit 2 ;;
esac
if test "${1:-legacy}" = "inbox-lifecycle" || test "${1:-legacy}" = "inbox-lifecycle-localstack"; then
  # Only a fresh local 0700 disposable Unix-socket PG17 can consume this
  # generated, SHA-pinned QA override. Never pass a remote connection string.
  KATOSYNC_INBOX_LIFECYCLE_QA_ONLY=LOCAL_DISPOSABLE_PG17 \
    node "$ROOT/scripts/qa-mesh-inbox-lifecycle-overlay.mjs" \
      "$DIR/inbox_lifecycle_overlay.sql"
  "$PG_BIN/psql" -h "$DIR" -p "$PORT" -U postgres -d postgres -X \
    -v ON_ERROR_STOP=1 -v inbox_lifecycle_overlay="$DIR/inbox_lifecycle_overlay.sql" \
    -f "$TEST_FILE"
else
  "$PG_BIN/psql" -h "$DIR" -p "$PORT" -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
    -f "$TEST_FILE"
fi
if test "${1:-legacy}" = "inbox-lifecycle-localstack"; then
  KATOSYNC_INBOX_LOCAL_STACK_QA_ONLY=EPHEMERAL_LOOPBACK_PG17 \
  KATOSYNC_MESH_E2E_SOCKET="$DIR" KATOSYNC_MESH_E2E_PORT="$PORT" \
  KATOSYNC_PG_BIN="$PG_BIN" \
    node --experimental-strip-types "$ROOT/tests/qa/meshInboxOwnerLocalStackStage4E.mjs"
elif test "${1:-legacy}" = "inbox-lifecycle"; then
  KATOSYNC_INBOX_LIFECYCLE_RACE_ALLOW=LOCAL_DISPOSABLE_PG17 \
  KATOSYNC_MESH_E2E_SOCKET="$DIR" KATOSYNC_MESH_E2E_PORT="$PORT" \
  KATOSYNC_PG_BIN="$PG_BIN" \
    node "$ROOT/tests/qa/meshInboxLifecycleRaceStage4E.mjs"
elif test "${1:-legacy}" = "quota-stage4e-atomic-writes"; then
  KATOSYNC_MESH_ATOMIC_RACE_ALLOW=EPHEMERAL_UNIX_SOCKET_ONLY \
  KATOSYNC_MESH_E2E_SOCKET="$DIR" KATOSYNC_MESH_E2E_PORT="$PORT" \
  KATOSYNC_PG_BIN="$PG_BIN" \
    node "$ROOT/tests/qa/meshAtomicEntitlementRaceStage4E.mjs"
elif test "${1:-legacy}" = "inbox-edge-e2e"; then
  KATOSYNC_MESH_E2E_ALLOW=EPHEMERAL_UNIX_SOCKET_ONLY \
    KATOSYNC_MESH_E2E_SOCKET="$DIR" KATOSYNC_MESH_E2E_PORT="$PORT" \
    node --experimental-strip-types --test "$ROOT/tests/meshInboxEdgePostgresE2e.qa.ts"
elif test "${1:-legacy}" = "inbox-relay-rust-e2e"; then
  test -f "${KATOSYNC_STAGE3K_RUST_FIXTURE:-/nonexistent}" || { echo STAGE3K_RUST_FIXTURE_REQUIRED >&2; exit 2; }
  KATOSYNC_MESH_E2E_ALLOW=EPHEMERAL_UNIX_SOCKET_ONLY \
    KATOSYNC_MESH_E2E_SOCKET="$DIR" KATOSYNC_MESH_E2E_PORT="$PORT" \
    node --experimental-strip-types --test "$ROOT/tests/meshRelayRustEdgePostgresStage3K.qa.ts"
fi
echo "MESH_QA_ALL_SQL_ASSERTIONS_PASSED"

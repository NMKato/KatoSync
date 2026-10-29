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
  inbox) TEST_FILE="$ROOT/tests/sql/mesh_inbox_send_qa.sql" ;;
  *) echo "MESH_QA_UNKNOWN_TEST_SELECTION" >&2; exit 2 ;;
esac
"$PG_BIN/psql" -h "$DIR" -p "$PORT" -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
  -f "$TEST_FILE"
echo "MESH_QA_ALL_SQL_ASSERTIONS_PASSED"

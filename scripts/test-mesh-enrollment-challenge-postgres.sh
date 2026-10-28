#!/usr/bin/env bash
# Created by NMKato Solutions
# Isolated local PostgreSQL test cluster, with no remote network listener.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$(pg_config --bindir)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp/}katosync-mesh-rls.XXXXXX")"
DATA="$TEMP_ROOT/data"
SOCKET="$TEMP_ROOT/socket"
mkdir -p "$SOCKET"
cleanup() {
  "$BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT
"$BIN/initdb" -D "$DATA" --no-instructions --no-locale -E UTF8 >/dev/null
"$BIN/pg_ctl" -D "$DATA" -o "-p 55471 -k '$SOCKET' -c listen_addresses=''" -w start >/dev/null
export PGHOST="$SOCKET" PGPORT=55471 PGUSER="$(id -un)" PGDATABASE=postgres
psql -v ON_ERROR_STOP=1 -X -q -f "$ROOT/tests/sql/mesh_registry_security.sql"
MIGRATION="$(find "$ROOT/supabase/migrations" -name '*_mesh_device_registry_fail_closed.sql' -print)"
test -n "$MIGRATION"
psql -v ON_ERROR_STOP=1 -X -q -f "$MIGRATION"
psql -v ON_ERROR_STOP=1 -X -q -f "$ROOT/tests/sql/mesh_registry_seed_and_assert.sql"
psql -v ON_ERROR_STOP=1 -X -q -c 'create role service_role nologin bypassrls'
ENROLLMENT="$(find "$ROOT/supabase/migrations" -name '*_mesh_device_enrollment_challenge.sql' -print)"
test -n "$ENROLLMENT"
psql -v ON_ERROR_STOP=1 -X -q -f "$ENROLLMENT"
psql -v ON_ERROR_STOP=1 -X -q -f "$ROOT/tests/sql/mesh_enrollment_challenge_security.sql"

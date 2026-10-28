#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$(pg_config --bindir)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp/}katosync-mesh-rt.XXXXXX")"
DATA="$TEMP_ROOT/data"
SOCKET="$TEMP_ROOT/socket"
mkdir -p "$SOCKET"
cleanup() { "$BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TEMP_ROOT"; }
trap cleanup EXIT
"$BIN/initdb" -D "$DATA" --no-instructions --no-locale -E UTF8 >/dev/null
"$BIN/pg_ctl" -D "$DATA" -o "-p 55474 -k '$SOCKET' -c listen_addresses=''" -w start >/dev/null
export PGHOST="$SOCKET" PGPORT=55474 PGUSER="$(id -un)" PGDATABASE=postgres
psql -X -q -v ON_ERROR_STOP=1 -f "$ROOT/tests/sql/mesh_realtime_setup.sql"
psql -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/migrations/20261028115220_mesh_owner_private_realtime_signaling.sql"
psql -X -q -v ON_ERROR_STOP=1 -f "$ROOT/tests/sql/mesh_realtime_assert.sql"

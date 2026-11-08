#!/usr/bin/env bash
# NMKato Solutions / Stage 2Z: ephemeral synthetic PG17 backup+restore QA only.
set -euo pipefail
umask 077
if [[ "${KATOSYNC_MESH_RESTORE_QA_ALLOW:-}" != "DISPOSABLE_UNIX_SOCKET_ONLY" || "$#" -ne 0 ]]; then
  echo "MESH_RESTORE_DRILL_BLOCKED: explicit disposable-only opt-in required" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="/opt/homebrew/opt/postgresql@17/bin"
for exe in initdb pg_ctl psql createdb pg_dump pg_restore; do
  test -x "$PG_BIN/$exe" || { echo "MESH_RESTORE_DRILL_BLOCKED: missing $exe" >&2;exit 2; }
done
DIR="$(mktemp -d /tmp/ksmeshqa.XXXXXX)"
if [[ ! "$DIR" =~ ^/tmp/ksmeshqa\.[A-Za-z0-9]{6}$ ]]; then
 echo "MESH_RESTORE_DRILL_BLOCKED: unexpected temporary directory" >&2;exit 3
fi
chmod 700 "$DIR"
PORT=55439
running=0
cleanup() {
  if [[ "$running" == 1 ]]; then
    "$PG_BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  [[ "$DIR" =~ ^/tmp/ksmeshqa\.[A-Za-z0-9]{6}$ ]] && /bin/rm -rf -- "$DIR"
}
trap cleanup EXIT INT TERM
"$PG_BIN/initdb" -D "$DIR/data" -A trust -U postgres --no-instructions >"$DIR/initdb.log" 2>&1
"$PG_BIN/pg_ctl" -D "$DIR/data" -l "$DIR/server.log" \
 -o "-c listen_addresses='' -c unix_socket_directories='$DIR' -p $PORT" \
 -w start >"$DIR/start.log" 2>&1
running=1
if "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -Atqc "select 1" >/dev/null 2>&1; then
 echo "MESH_RESTORE_DRILL_BLOCKED: unexpected TCP listener" >&2;exit 4
fi
PSQL=("$PG_BIN/psql" -X -q -A -t -v ON_ERROR_STOP=1 -h "$DIR" -p "$PORT" -U postgres)
# No inherited cron / outbound pg_net extensions in either QA database.
external_jobs_guard() {
 local db="$1"
 local found
 found="$("$PG_BIN/psql" -X -q -A -t -v ON_ERROR_STOP=1 -h "$DIR" -p "$PORT" -U postgres -d "$db" -c "SELECT count(*) FROM pg_extension WHERE extname IN ('pg_cron','pg_net','postgres_fdw','http')")"
 if [[ "$found" != "0" ]]; then
  echo "MESH_RESTORE_EXTERNAL_JOBS_BLOCKED: extension present" >&2;exit 10
 fi
 found="$("$PG_BIN/psql" -X -q -A -t -v ON_ERROR_STOP=1 -h "$DIR" -p "$PORT" -U postgres -d "$db" -c "SELECT count(*) FROM pg_namespace WHERE nspname IN ('cron','net')")"
 if [[ "$found" != "0" ]]; then
  echo "MESH_RESTORE_EXTERNAL_JOBS_BLOCKED: outbound schema present" >&2;exit 10
 fi
}
echo "MESH_RESTORE_DRILL_EPHEMERAL_UNIX_SOCKET_ONLY"
external_jobs_guard postgres
"${PSQL[@]}" -d postgres -f "$ROOT/tests/sql/mesh_inbox_edge_e2e_setup.sql" >"$DIR/schema-fixture.log"
KATOSYNC_MESH_E2E_ALLOW=EPHEMERAL_UNIX_SOCKET_ONLY \
 KATOSYNC_MESH_E2E_SOCKET="$DIR" KATOSYNC_MESH_E2E_PORT="$PORT" \
 node --experimental-strip-types --test "$ROOT/tests/meshInboxEdgePostgresE2e.qa.ts" \
 >"$DIR/signed-e2e.log" 2>&1 || { tail -50 "$DIR/signed-e2e.log" >&2;exit 5; }
grep -q 'MESH_EDGE_PG_REAL_SQL_ED25519_E2E_PASS' "$DIR/signed-e2e.log" || {
 echo "MESH_RESTORE_DRILL_BLOCKED: unsigned fixture" >&2;exit 5;
}
data_fingerprint() {
 local db="$1"
 "${PSQL[@]}" -d "$db" -c "SELECT md5(
 (SELECT coalesce(string_agg(to_jsonb(d)::text,'|' ORDER BY d.device_id),'') FROM katosync.mesh_devices d) ||
 '#' ||
 (SELECT coalesce(string_agg(to_jsonb(i)::text,'|' ORDER BY i.request_id),'') FROM katosync.mesh_invites i) ||
 '#' ||
 (SELECT coalesce(string_agg(to_jsonb(p)::text,'|' ORDER BY p.proof_id),'') FROM katosync.mesh_inbox_proofs p));"
}
before="$(data_fingerprint postgres)"
[[ "$before" =~ ^[a-f0-9]{32}$ ]] || { echo "MESH_RESTORE_DRILL_BLOCKED: fingerprint missing" >&2;exit 6; }
test "$("${PSQL[@]}" -d postgres -c "select count(*) from katosync.mesh_devices")" = 2
test "$("${PSQL[@]}" -d postgres -c "select count(*) from katosync.mesh_invites")" = 3
test "$("${PSQL[@]}" -d postgres -c "select count(*) from katosync.mesh_devices where membership_state='trusted'")" = 0
"$PG_BIN/pg_dump" -h "$DIR" -p "$PORT" -U postgres -d postgres --format=custom --compress=6 --file="$DIR/synthetic.pgcustom"
test -s "$DIR/synthetic.pgcustom"
shasum -a 256 "$DIR/synthetic.pgcustom" | awk '{print "MESH_RESTORE_DRILL_ARCHIVE_SHA256: "$1}'
"$PG_BIN/createdb" -h "$DIR" -p "$PORT" -U postgres -T template0 recovered
"$PG_BIN/pg_restore" -h "$DIR" -p "$PORT" -U postgres -d recovered --no-owner --exit-on-error "$DIR/synthetic.pgcustom" >"$DIR/restore.log" 2>&1 || {
 tail -60 "$DIR/restore.log" >&2;exit 7;
}
external_jobs_guard recovered
after="$(data_fingerprint recovered)"
test "$before" = "$after" || { echo "MESH_RESTORE_DRILL_BLOCKED: restored data mismatch" >&2;exit 8; }
echo "MESH_RESTORE_DRILL_DATA_FINGERPRINT_MATCH"
"${PSQL[@]}" -d recovered <<'SQL'
DO $$
DECLARE found integer;
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='katosync.mesh_inbox_proofs'::regclass)
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='katosync.mesh_invites'::regclass)
 OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='katosync.mesh_devices'::regclass)
 THEN RAISE EXCEPTION 'MESH_RESTORE_RLS_MISSING'; END IF;
 IF has_table_privilege('authenticated','katosync.mesh_invites','SELECT')
 OR has_table_privilege('authenticated','katosync.mesh_invites','INSERT')
 OR has_table_privilege('authenticated','katosync.mesh_invites','UPDATE')
 OR has_table_privilege('authenticated','katosync.mesh_inbox_proofs','INSERT')
 OR NOT has_table_privilege('service_role','katosync.mesh_invites','UPDATE')
 THEN RAISE EXCEPTION 'MESH_RESTORE_CLIENT_PRIVILEGE_DRIFT'; END IF;
 SELECT count(*) INTO found FROM pg_trigger WHERE NOT tgisinternal AND
  tgrelid IN ('katosync.mesh_invites'::regclass,'katosync.mesh_inbox_proofs'::regclass)
  AND tgname IN ('katosync_mesh_invite_send_guard_before_insert',
   'katosync_mesh_inbox_proof_rate_before_insert',
   'katosync_mesh_inbox_resolution_before_update',
   'katosync_mesh_inbox_resolution_proof_before_update',
   'katosync_mesh_inbox_proof_key_before_insert',
   'katosync_mesh_inbox_recipient_key_resolution_before_update');
 IF found<>6 THEN RAISE EXCEPTION 'MESH_RESTORE_MISSING_PROTECTION_TRIGGERS: %',found; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mesh_inbox_proof_signing_key_required')
 THEN RAISE EXCEPTION 'MESH_RESTORE_RECIPIENT_KEY_CONSTRAINT_MISSING';END IF;
 IF (SELECT count(*) FROM katosync.mesh_devices)<>2
 OR (SELECT count(*) FROM katosync.mesh_invites)<>3
 OR (SELECT count(*) FROM katosync.mesh_devices WHERE membership_state='trusted')<>0
 THEN RAISE EXCEPTION 'MESH_RESTORE_WRONG_RECOVERY_STATE';END IF;
END $$;
SQL
echo "MESH_RESTORE_DRILL_RLS_GRANTS_TRIGGERS_PASS"
echo "MESH_RESTORE_NO_CRON_OR_NET_EXTENSIONS_PASS"
"${PSQL[@]}" -d postgres -c \
 "UPDATE katosync.mesh_devices SET membership_state='revoked',revoked_at=now()
 WHERE device_id='22222222-2222-4222-8222-222222222222'" >/dev/null
test "$(data_fingerprint postgres)" != "$before" || {
 echo "MESH_RESTORE_DRILL_BLOCKED: source mutation not detected" >&2;exit 9;
}
test "$(data_fingerprint recovered)" = "$before" || {
 echo "MESH_RESTORE_DRILL_BLOCKED: recovery state changed" >&2;exit 9;
}
echo "MESH_RESTORE_DRILL_SOURCE_MUTATION_ISOLATED"
echo "MESH_RESTORE_DRILL_PASS_DISPOSABLE_ONLY"

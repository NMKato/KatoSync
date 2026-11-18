#!/usr/bin/env bash
# NMKato Solutions / Stage 3W: ONLY disposable Unix-socket PostgreSQL.
# A local synthetic restore does not prove live Supabase recovery.
set -euo pipefail
umask 077
if [[ "${KATOSYNC_STAGE3W_RESTORE_ALLOW:-}" != "SYNTHETIC_UNIX_SOCKET_ONLY" || "$#" -ne 0 ]]; then
  echo "STAGE3W_RESTORE_BLOCKED: explicit synthetic-only opt-in required" >&2; exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="/opt/homebrew/opt/postgresql@17/bin"
for executable in initdb pg_ctl psql pg_dump pg_restore createdb; do
  test -x "$BIN/$executable" || { echo "STAGE3W_MISSING_POSTGRES17" >&2;exit 2; }
done
DIR="$(mktemp -d /tmp/ksmeshqa.XXXXXX)"
[[ "$DIR" =~ ^/tmp/ksmeshqa\.[A-Za-z0-9]{6}$ ]] || exit 3
chmod 700 "$DIR"
PORT=55439
running=0
cleanup(){
 if [[ "$running" == 1 ]]; then
  "$BIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true
 fi
 [[ "$DIR" =~ ^/tmp/ksmeshqa\.[A-Za-z0-9]{6}$ ]] && /bin/rm -rf -- "$DIR"
}
trap cleanup EXIT INT TERM
"$BIN/initdb" -D "$DIR/data" -A trust -U postgres --no-instructions >"$DIR/init.log" 2>&1
"$BIN/pg_ctl" -D "$DIR/data" -l "$DIR/postgres.log" \
 -o "-c listen_addresses='' -c unix_socket_directories='$DIR' -p $PORT" \
 -w start >"$DIR/start.log" 2>&1
running=1
if "$BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -c 'select 1' >/dev/null 2>&1; then
 echo "STAGE3W_TCP_LISTENER_BLOCKED" >&2;exit 4
fi
psql_exec(){ "$BIN/psql" -h "$DIR" -p "$PORT" -U postgres -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }
echo "STAGE3W_LOCAL_UNIX_SOCKET_ONLY"
psql_exec -d postgres -f "$ROOT/tests/sql/mesh_stage3v_shared_schema_compat.sql" >"$DIR/schema-qa.log" 2>&1 || {
 tail -30 "$DIR/schema-qa.log" >&2;exit 5;
}
grep -q "STAGE3V_SHARED_KATOOS_SCHEMA_COMPAT_PASS" "$DIR/schema-qa.log"
digest(){ psql_exec -d "$1" -f "$ROOT/tests/sql/mesh_stage3w_recovery_integrity.sql" | tr -d '\n'; }
before="$(digest postgres)"
[[ "$before" =~ ^[a-f0-9]{32}$ ]] || exit 6
"$BIN/pg_dump" -h "$DIR" -p "$PORT" -U postgres -d postgres --format=custom --compress=6 --file="$DIR/synthetic.pgcustom"
test -s "$DIR/synthetic.pgcustom"
"$BIN/createdb" -h "$DIR" -p "$PORT" -U postgres -T template0 recovered
"$BIN/pg_restore" -h "$DIR" -p "$PORT" -U postgres -d recovered --no-owner --exit-on-error "$DIR/synthetic.pgcustom" >"$DIR/restore.log" 2>&1 || {
 tail -40 "$DIR/restore.log" >&2;exit 7;
}
after="$(digest recovered)"
[[ "$before" == "$after" ]] || { echo "STAGE3W_RESTORE_DATA_MISMATCH" >&2; exit 8; }
echo "STAGE3W_EIGHT_TABLE_DATA_FINGERPRINT_MATCH"
psql_exec -d recovered <<'SQL'
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
  WHERE s.nspname='katosync' AND c.relkind IN ('r','p') AND c.relrowsecurity;
 IF n<>8 THEN RAISE EXCEPTION 'STAGE3W_EIGHT_RLS_TABLES_NOT_RESTORED: %',n; END IF;
 IF has_schema_privilege('anon','katosync','USAGE') OR
    has_table_privilege('authenticated','katosync.mesh_invites','SELECT') OR
    has_table_privilege('authenticated','katosync.mesh_inbox_proofs','SELECT') OR
    has_table_privilege('authenticated','katosync.mesh_pairing_relay_messages','SELECT') OR
    has_table_privilege('authenticated','katosync.mesh_pairing_relay_reads','SELECT') OR
    NOT has_table_privilege('authenticated','katosync.account_memberships','SELECT') OR
    NOT has_table_privilege('service_role','katosync.mesh_pairing_relay_messages','INSERT')
 THEN RAISE EXCEPTION 'STAGE3W_RESTORED_ROLE_PRIVILEGES_WRONG'; END IF;
 IF (SELECT count(*) FROM pg_extension WHERE extname IN ('pg_cron','pg_net','postgres_fdw','http'))<>0
 THEN RAISE EXCEPTION 'STAGE3W_RESTORED_EXTERNAL_EXTENSION'; END IF;
 SELECT count(*) INTO n FROM pg_trigger
 WHERE NOT tgisinternal AND tgrelid IN
 ('katosync.mesh_invites'::regclass,'katosync.mesh_inbox_proofs'::regclass,
 'katosync.mesh_pairing_relay_messages'::regclass,
 'katosync.mesh_pairing_relay_reads'::regclass);
 IF n<8 THEN RAISE EXCEPTION 'STAGE3W_PROTECTION_TRIGGERS_MISSING: %',n; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM katosync.account_memberships)<>1 OR
    (SELECT count(*) FROM katosync.mesh_devices)<>2
 THEN RAISE EXCEPTION 'STAGE3W_RESTORED_OWNER_RLS_FAILED'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
DO $$
BEGIN
 IF (SELECT count(*) FROM katosync.account_memberships)<>0 OR
    (SELECT count(*) FROM katosync.mesh_devices)<>0
 THEN RAISE EXCEPTION 'STAGE3W_RESTORED_FOREIGN_RLS_FAILED'; END IF;
END $$;
RESET ROLE;
SQL
echo "STAGE3W_RESTORED_RLS_AND_ROLE_GATES_PASS"
psql_exec -d postgres -c "UPDATE katosync.mesh_devices SET display_name='synthetic changed only in source' WHERE signing_public_key=repeat('A',43)" > /dev/null
[[ "$(digest postgres)" != "$before" && "$(digest recovered)" == "$before" ]] || {
 echo "STAGE3W_RESTORE_SOURCE_ISOLATION_FAILED" >&2; exit 9;
}
echo "STAGE3W_RESTORED_DATA_UNCHANGED_AFTER_SOURCE_MUTATION"
echo "STAGE3W_FULL_EIGHT_TABLES_DISPOSABLE_RESTORE_PASS"

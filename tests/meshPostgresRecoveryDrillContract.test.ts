// NMKato Solutions – Stage 2Z: no production path through restore drill.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const script=fileURLToPath(new URL("../scripts/qa-mesh-postgres-recovery-drill.sh",import.meta.url));
const source=readFileSync(script,"utf8");

test("disposable restore rehearsal is denied by default",()=>{
 assert.match(source,/KATOSYNC_MESH_RESTORE_QA_ALLOW/);
 assert.match(source,/DISPOSABLE_UNIX_SOCKET_ONLY/);
 assert.match(source,/MESH_RESTORE_DRILL_BLOCKED: explicit disposable-only opt-in required/);
 // CI on Windows is not required to have Bash or local Homebrew PG17.
 if(process.platform==="win32")return;
 const r=spawnSync("bash",[script],{
  encoding:"utf8",timeout:3000,
  env:{PATH:process.env.PATH??"",HOME:"/tmp"}
 });
 assert.equal(r.status,2,r.stderr);
 assert.match(r.stderr,/MESH_RESTORE_DRILL_BLOCKED/);
});
test("PG17 clusters are private Unix-socket only and cleanup is trapped",()=>{
 assert.match(source,/\/opt\/homebrew\/opt\/postgresql@17\/bin/);
 assert.match(source,/mktemp -d \/tmp\/ksmeshqa\.XXXXXX/);
 assert.match(source,/chmod 700/);
 assert.match(source,/umask 077/);
 assert.match(source,/listen_addresses=''/);
 assert.match(source,/unix_socket_directories/);
 assert.match(source,/127\.0\.0\.1/);
 assert.match(source,/MESH_RESTORE_DRILL_BLOCKED: unexpected TCP listener/);
 assert.match(source,/trap cleanup EXIT INT TERM/);
 assert.match(source,/pg_ctl.*-m immediate stop/);
 assert.match(source,/\/bin\/rm -rf -- "\$DIR"/);
 assert.doesNotMatch(source,/supabase\s+(db\s+push|migration\s+repair|backups\s+restore|functions\s+deploy)/);
});
test("restore is a real archive+restore, not a SQL copy or schema-only claim",()=>{
 assert.match(source,/mesh_inbox_edge_e2e_setup\.sql/);
 assert.match(source,/meshInboxEdgePostgresE2e\.qa\.ts/);
 assert.match(source,/MESH_EDGE_PG_REAL_SQL_ED25519_E2E_PASS/);
 assert.match(source,/pg_dump/);
 assert.match(source,/--format=custom/);
 assert.match(source,/pg_restore/);
 assert.match(source,/--exit-on-error/);
 assert.match(source,/createdb/);
 assert.match(source,/data_fingerprint postgres/);
 assert.match(source,/data_fingerprint recovered/);
 assert.match(source,/MESH_RESTORE_DRILL_DATA_FINGERPRINT_MATCH/);
 assert.match(source,/MESH_RESTORE_DRILL_SOURCE_MUTATION_ISOLATED/);
 assert.match(source,/MESH_RESTORE_DRILL_PASS_DISPOSABLE_ONLY/);
});
test("recovered data requires original RLS, client denial, trigger continuity and zero trust",()=>{
 assert.match(source,/mesh_inbox_proofs.*regclass/);
 assert.match(source,/mesh_invites.*regclass/);
 assert.match(source,/mesh_devices.*regclass/);
 assert.match(source,/has_table_privilege\('authenticated'/);
 assert.match(source,/has_table_privilege\('service_role'/);
 assert.match(source,/IF found<>6/);
 assert.match(source,/mesh_inbox_proof_signing_key_required/);
 assert.match(source,/MESH_RESTORE_RLS_MISSING/);
 assert.match(source,/MESH_RESTORE_CLIENT_PRIVILEGE_DRIFT/);
 assert.match(source,/MESH_RESTORE_MISSING_PROTECTION_TRIGGERS/);
 assert.match(source,/membership_state='trusted'/);
 assert.match(source,/MESH_RESTORE_DRILL_RLS_GRANTS_TRIGGERS_PASS/);
});

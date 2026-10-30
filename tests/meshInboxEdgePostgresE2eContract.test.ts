// NMKato Solutions: safety contract for the manual PostgreSQL-backed QA runner.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const run=read("../scripts/qa-mesh-postgres-local.sh");
const qa=read("meshInboxEdgePostgresE2e.qa.ts");
const sql=read("sql/mesh_inbox_edge_e2e_setup.sql");
test("direct E2E entrypoint without explicit disposable socket fails before database access",()=>{
 const result=spawnSync(process.execPath,["--experimental-strip-types",
  new URL("meshInboxEdgePostgresE2e.qa.ts",import.meta.url).pathname],{
  encoding:"utf8",timeout:2000,env:{PATH:process.env.PATH??""}
 });
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/MESH_E2E_BLOCKED/);
});
test("QA bootstrap is local-only, TCP-off, trapped cleanup and no live tokens",()=>{
 for(const marker of ["listen_addresses=''","unix_socket_directories=",
 "trap cleanup EXIT INT TERM","-h 127.0.0.1",
 "inbox-edge-e2e","MESH_E2E_SOCKET=","EPHEMERAL_UNIX_SOCKET_ONLY"])
  assert.ok(run.includes(marker),"Missing QA guard: "+marker);
 assert.match(qa,/^if\(!\/\^\\\/tmp\\\/ksmeshqa/mi);
 assert.match(qa,/MESH_E2E_BLOCKED/);
 assert.match(qa,/url\.origin!==ORIGIN/);
 assert.match(qa,/SET ROLE service_role/);
 assert.match(qa,/MESH_EDGE_PG_REAL_SQL_ED25519_E2E_PASS/);
 assert.doesNotMatch(qa,/https?:\/\/localhost:5432|SUPABASE_SERVICE_ROLE_KEY=eyJ/);
});
test("end-to-end fixture applies the reviewed FOUR inbox migrations only in disposable PostgreSQL",()=>{
 for(const version of [
 "20261028202403","20261029211243","20261030072543",
 "20261030074910","20261030093323"])
  assert.ok(sql.includes(version));
 assert.match(sql,/MESH_E2E_NOT_ISOLATED_OR_WRONG_ROLES/);
 assert.match(qa,/real PostgreSQL-backed signed Edge send/);
 assert.match(qa,/sourceDeviceId:SOURCE,targetDeviceId:TARGET/);
 assert.match(qa,/crypto\.subtle\.sign\("Ed25519"/);
 assert.match(qa,/INBOX_SOURCE_UNVERIFIED/);
 assert.match(qa,/invalidTarget\.status,503/);
 assert.match(qa,/trusted:0/);
});

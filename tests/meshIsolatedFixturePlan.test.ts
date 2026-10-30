// NMKato Solutions – Stage 3A offline-only deterministic Mesh QA allowlist.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {join,resolve} from "node:path";
import {createPlan,validateIsolation} from "../scripts/qa-mesh-isolated-fixture-plan.mjs";
import {MIGRATIONS} from "../scripts/qa-mesh-inbox-rollout-gate.mjs";
const root=fileURLToPath(new URL("..",import.meta.url));
const cmd=fileURLToPath(new URL("../scripts/qa-mesh-isolated-fixture-plan.mjs",import.meta.url));
const fixture=()=>({
 fixture:readFileSync(join(root,"tests/sql/mesh_inbox_edge_e2e_setup.sql"),"utf8"),
 restore:readFileSync(join(root,"scripts/qa-mesh-postgres-recovery-drill.sh"),"utf8"),
 migrations:MIGRATIONS.filter(x=>x.kind==="inbox").map(x=>readFileSync(
  join(root,"supabase/migrations",x.version+"_"+x.name+".sql"),"utf8"))
});
test("actual pinned source tree produces a non-deployable, synthetic-only QA manifest",async()=>{
 const x=await createPlan();
 assert.equal(x.result,"OFFLINE_SYNTHETIC_QA_PLAN_ONLY");
 assert.equal(x.executionTarget,"LOCAL_POSTGRES17_UNIX_SOCKET_ONLY");
 assert.deepEqual(x.sqlMigrationVersions,MIGRATIONS.filter(y=>y.kind==="inbox").map(y=>y.version));
 assert.equal(x.sqlSha256.length,4);
 assert.equal(x.edges.length,2);
 assert.equal(x.syntheticDevices,2);
 assert.equal(x.syntheticInvites,3);
 assert.equal(x.expectedTrustedDevices,0);
 for(const field of ["cloudProjectCreated","cloudBranchCreated","cloudDeployment",
   "productionDataIncluded","productionCredentialsIncluded","cronJobsIncluded",
   "pgNetIncluded","realSupabaseRestore","jwtPlatformVerified","operatorApproval",
   "authorizedToDeploy","trustEnabled","remoteJobsEnabled"]as const)
  assert.equal(x[field],false);
 assert.ok(x.sqlSha256.every(y=>/^[a-f0-9]{64}$/.test(y.sha256)));
 assert.ok(x.edges.every(y=>/^[a-f0-9]{64}$/.test(y.sha256)));
 assert.ok(!JSON.stringify(x).includes("SERVICE_ROLE_KEY"));
 assert.ok(!JSON.stringify(x).includes("22222222-2222-4222-8222-222222222222"));
});
test("fixture rejects unauthorized migration includes and omitted synthetic account",()=>{
 const x=fixture();
 assert.equal(validateIsolation(x),true);
 const extra=fixture();
 extra.fixture+="\n\\ir ../../supabase/migrations/unreviewed.sql\n";
 assert.throws(()=>validateIsolation(extra),/UNREVIEWED_MIGRATION_INCLUDE/);
 const reordered=fixture();
 reordered.fixture=reordered.fixture.replace(
  "20261029211243_mesh_inbox_signed_send_guard.sql",
  "20261030093323_mesh_inbox_recipient_key_continuity.sql");
 assert.throws(()=>validateIsolation(reordered),/UNREVIEWED_MIGRATION_INCLUDE/);
 const owner=fixture();
 owner.fixture=owner.fixture.replace(
  "11111111-1111-4111-8111-111111111111",
  "ffffffff-ffff-4fff-8fff-ffffffffffff");
 assert.throws(()=>validateIsolation(owner),/NOT_SYNTHETIC_AUTH/);
});
test("logical QA plan blocks pg_cron, pg_net, external HTTP, extensions and destructive SQL",()=>{
 for(const fragment of [
  "CREATE EXTENSION pg_cron;","SELECT net.http_post('http://example.invalid');",
  "SELECT net.http_get('http://example.invalid');",
  "SELECT cron.schedule('x','* * * * *',$$ select 1 $$);",
  "DROP SCHEMA katosync CASCADE;","SELECT vault.decrypted_secrets;",
  "SELECT 'https://external.invalid';"
 ]){
  const x=fixture();
  x.migrations[0]+="\n"+fragment;
  assert.throws(()=>validateIsolation(x),/EXTERNAL_OR_DESTRUCTIVE_SQL/,fragment);
 }
});
test("restore must enforce no cron/net on source AND recovered database",()=>{
 const source=readFileSync(join(root,"scripts/qa-mesh-postgres-recovery-drill.sh"),"utf8");
 assert.match(source,/MESH_RESTORE_EXTERNAL_JOBS_BLOCKED/);
 assert.match(source,/external_jobs_guard postgres/);
 assert.match(source,/external_jobs_guard recovered/);
 assert.match(source,/pg_cron/);
 assert.match(source,/pg_net/);
 assert.match(source,/MESH_RESTORE_NO_CRON_OR_NET_EXTENSIONS_PASS/);
 const x=fixture();x.restore=x.restore.replace("external_jobs_guard recovered","");
 assert.throws(()=>validateIsolation(x),/RESTORE_NO_ISOLATION_PROOF/);
});
test("offline plan is default-deny and never starts a cloud session without exact flag",()=>{
 for(const argv of [[],["--deploy"],["--offline-synthetic","--yes"]]){
  const r=spawnSync(process.execPath,[cmd,...argv],{encoding:"utf8",timeout:2500});
  assert.equal(r.status,2);
  assert.match(r.stderr,/EXPLICIT_OFFLINE_SYNTHETIC_REQUIRED/);
 }
});

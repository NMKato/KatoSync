#!/usr/bin/env node
// NMKato Solutions — Stage 3A. OFFLINE only, synthetic fixture allowlist.
// This executable has no cloud/SQL write/deploy command or network access.
import {readFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import {buildReview} from "./qa-mesh-inbox-edge-package-review.mjs";
import {MIGRATIONS} from "./qa-mesh-inbox-rollout-gate.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const FIXTURE="tests/sql/mesh_inbox_edge_e2e_setup.sql";
const RESTORE="scripts/qa-mesh-postgres-recovery-drill.sh";
const REPLAY=MIGRATIONS.filter(x=>x.kind==="inbox");
const fail=reason=>{throw Error("MESH_ISOLATED_FIXTURE_BLOCKED: "+reason);};

// Designed to reject destructive or outbound SQL, not to prove arbitrary SQL
// safe. Only the immutable SHA256-pinned migration set is ever accepted.
export function validateIsolation({fixture,restore,migrations}){
 if(typeof fixture!=="string"||typeof restore!=="string"||
    !Array.isArray(migrations)||migrations.length!==4)
   fail("INCOMPLETE_FIXTURE");
 const refs=[...fixture.matchAll(/^\\ir\s+(.+)$/gm)].map(x=>x[1].trim());
 const expected=[MIGRATIONS[0],...REPLAY].map(x=>
  "../../supabase/migrations/"+x.version+"_"+x.name+".sql");
 if(JSON.stringify(refs)!==JSON.stringify(expected))
   fail("UNREVIEWED_MIGRATION_INCLUDE");
 if(!fixture.includes("CREATE SCHEMA auth;")||
    !fixture.includes("CREATE TABLE auth.users(id uuid PRIMARY KEY)")||
    !fixture.includes("INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111')"))
   fail("NOT_SYNTHETIC_AUTH");
 const forbidden=/(?:\b(?:create\s+extension|alter\s+extension|pg_cron|pg_net|cron\.|net\.|http_get|http_post|dblink|postgres_fdw|vault\.|storage\.|insert\s+into\s+cron|drop\s+(?:database|schema))\b|https?:\/\/)/i;
 for(const [name,sql] of [["fixture",fixture],
  ...migrations.map((sql,i)=>["migration-"+(i+1),sql])]){
  if(typeof sql!=="string"||forbidden.test(sql))
    fail("EXTERNAL_OR_DESTRUCTIVE_SQL_"+name);
 }
 // Production credentials and entire KATOOS database must never enter QA.
 if(!restore.includes("DISPOSABLE_UNIX_SOCKET_ONLY")||
    !restore.includes("listen_addresses=''")||
    !restore.includes("MESH_RESTORE_DRILL_BLOCKED: unexpected TCP listener")||
    !restore.includes("MESH_RESTORE_DRILL_PASS_DISPOSABLE_ONLY")||
    !restore.includes("MESH_RESTORE_EXTERNAL_JOBS_BLOCKED")||
    !restore.includes("external_jobs_guard postgres")||
    !restore.includes("external_jobs_guard recovered")||
    !restore.includes("MESH_RESTORE_NO_CRON_OR_NET_EXTENSIONS_PASS")||
    !restore.includes("pg_dump")||!restore.includes("pg_restore"))
    fail("RESTORE_NO_ISOLATION_PROOF");
 return true;
}
export async function createPlan(root=ROOT){
 const verified=await buildReview(root); // SHA pin BOTH SQL and Edge source
 const fixture=readFileSync(join(root,FIXTURE),"utf8");
 const restore=readFileSync(join(root,RESTORE),"utf8");
 const sql=REPLAY.map(x=>readFileSync(join(root,"supabase/migrations",
   x.version+"_"+x.name+".sql"),"utf8"));
 validateIsolation({fixture,restore,migrations:sql});
 return Object.freeze({
  result:"OFFLINE_SYNTHETIC_QA_PLAN_ONLY",
  executionTarget:"LOCAL_POSTGRES17_UNIX_SOCKET_ONLY",
  cloudProjectCreated:false,cloudBranchCreated:false,cloudDeployment:false,
  productionDataIncluded:false,productionCredentialsIncluded:false,
  cronJobsIncluded:false,pgNetIncluded:false,realSupabaseRestore:false,
  jwtPlatformVerified:false,
  syntheticDevices:2,syntheticInvites:3,expectedTrustedDevices:0,
  sourceDatabase:"DISPOSABLE_SYNTHETIC_FIXTURE",
  sqlMigrationVersions:verified.migrationOrder,
  sqlSha256:verified.migrationHashes.map(x=>({version:x.version,sha256:x.sha256})),
  edges:verified.edgeBundles.map(x=>({name:x.name,sha256:x.sha256})),
  reproduce:"KATOSYNC_MESH_RESTORE_QA_ALLOW=DISPOSABLE_UNIX_SOCKET_ONLY bash scripts/qa-mesh-postgres-recovery-drill.sh",
  operatorApproval:false,authorizedToDeploy:false,trustEnabled:false,
  remoteJobsEnabled:false
 });
}
export async function main(args=process.argv.slice(2)){
 if(args.length!==1||args[0]!=="--offline-synthetic")
   fail("EXPLICIT_OFFLINE_SYNTHETIC_REQUIRED");
 return createPlan();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(await main(),null,2)+"\n");}
 catch(e){process.stderr.write(String(e?.message??e)+"\n");process.exitCode=2;}
}

// NMKato Solutions: Stage 2W pinned Edge release package; offline-only.
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {buildReview} from "../scripts/qa-mesh-inbox-edge-package-review.mjs";
import {MIGRATIONS,PROJECT} from "../scripts/qa-mesh-inbox-rollout-gate.mjs";
const root=fileURLToPath(new URL("..",import.meta.url));
const script=fileURLToPath(new URL("../scripts/qa-mesh-inbox-edge-package-review.mjs",import.meta.url));
const baseline=()=>({
 projectRef:PROJECT,
 migrations:MIGRATIONS.filter(x=>x.kind==="base").map(({version,name})=>({version,name})),
 edgeFunctions:["mesh-device-enrollment"],
 database:{
  invites:0,resolved:0,discovered:2,trusted:0,owners:1,revoked:0,missingKeys:0,
  proofTable:0,dispatchColumn:0,resolutionColumn:0,proofKeyColumn:0,
  directClientInviteSelect:true,serviceInviteUpdate:true,proofTableRls:false,
  proofTableClientWrite:false,proofKeyConstraint:false,proofKeyInsertTrigger:false,
  proofKeyResolutionTrigger:false
 }
});
const files=[
 ...MIGRATIONS
 .map(x=>"supabase/migrations/"+x.version+"_"+x.name+".sql"),
 ...["mesh-inbox-send/index.ts","mesh-inbox-send/send.ts","mesh-inbox-receive/index.ts",
    "mesh-inbox-receive/receive.ts","mesh-device-enrollment/membership-gate.ts"]
    .map(x=>"supabase/functions/"+x),
 "src-tauri/src/mesh_inbox.rs","src-tauri/src/mesh_inbox_receiver.rs",
 "src/components/MeshConnectionCard.tsx"
];
function withMirror(fn:(dir:string)=>Promise<void>|void){
 const dir=mkdtempSync(join(tmpdir(),"ksmesh-edge-review-"));
 return Promise.resolve().then(async()=>{
  for(const rel of files){
   mkdirSync(dirname(join(dir,rel)),{recursive:true});
   copyFileSync(join(root,rel),join(dir,rel));
  }
  await fn(dir);
 }).finally(()=>rmSync(dir,{recursive:true,force:true}));
}
test("two unchanged Deno Edge entrypoints compile with all pinned security dependencies",async()=>{
 const x=await buildReview(root,baseline());
 assert.equal(x.result,"REVIEW_ONLY_NO_DEPLOYMENT");
 assert.deepEqual(x.migrationOrder,MIGRATIONS.filter(y=>y.kind==="inbox").map(y=>y.version));
 assert.equal(x.sourceFiles.length,5);
 const attributes=readFileSync(join(root,".gitattributes"),"utf8").split(/\r?\n/);
 for(const f of x.sourceFiles) {
  assert.ok(attributes.includes(f.name+" text eol=lf"),
   "Windows checkout must preserve pinned Edge source bytes: "+f.name);
  assert.ok(!readFileSync(join(root,f.name),"utf8").includes("\r"),
   "Reviewed Edge source must use LF only: "+f.name);
 }
 assert.equal(x.edgeBundles.length,2);
 assert.equal(x.baseline.result,"BASELINE_MATCHES_REVIEW_ONLY");
 assert.equal(x.authorizedToDeploy,false);
 assert.equal(x.activationFlagsApplied,false);
 assert.equal(x.trustEnabled,false);
 assert.equal(x.remoteJobsEnabled,false);
 assert.equal(x.jwtVerificationRequired,true);
 for(const b of x.edgeBundles){
  assert.match(b.sha256,/^[a-f0-9]{64}$/);
  assert.equal(b.stageFlagDefault,"disabled");
  assert.ok(b.byteLength>1000);
 }
});
test("reviewer rejects any changed Edge source rather than silently updating a fingerprint",async()=>{
 await withMirror(async dir=>{
  const path=join(dir,"supabase/functions/mesh-inbox-send/send.ts");
  writeFileSync(path,readFileSync(path,"utf8")+"\n// modified QA source\n");
  await assert.rejects(buildReview(dir,baseline()),
   /MESH_EDGE_PACKAGE_BLOCKED: EDGE_SOURCE_HASH_CHANGED/);
 });
});
test("reviewer rejects a changed SQL migration, preserving exact Windows/macOS bytes",async()=>{
 await withMirror(async dir=>{
  const p=join(dir,"supabase/migrations/20261029211243_mesh_inbox_signed_send_guard.sql");
  writeFileSync(p,readFileSync(p,"utf8").replaceAll("\n","\r\n"));
  await assert.rejects(buildReview(dir,baseline()),
   /MESH_ROLLOUT_BLOCKED: MIGRATION_HASH_CHANGED_20261029211243/);
 });
});
test("reviewer never upgrades partial/live changes to permission for release",async()=>{
 const x=baseline();x.database.trusted=1;
 await assert.rejects(buildReview(root,x),/DEVICE_REGISTRY_UNEXPECTED/);
 const y=baseline();y.edgeFunctions.push("mesh-inbox-receive");
 await assert.rejects(buildReview(root,y),/EDGE_ALREADY_PRESENT/);
});
test("CLI is disabled without an explicit locally supplied non-secret snapshot",()=>{
 const r=spawnSync(process.execPath,[script],{encoding:"utf8",timeout:3000});
 assert.equal(r.status,2);
 assert.match(r.stderr,/REQUIRES_OFFLINE_BASELINE_SNAPSHOT/);
 const other=spawnSync(process.execPath,[script,"--snapshot","https://example.test/data"],{
  encoding:"utf8",timeout:3000
 });
 assert.equal(other.status,2);
 assert.match(other.stderr,/LOCAL_SNAPSHOT_ONLY/);
});

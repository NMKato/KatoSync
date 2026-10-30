// NMKato Solutions – offline, read-only QA release gate contract.
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {validateSnapshot,verifyLocalContract,MIGRATIONS,run,PROJECT} from "../scripts/qa-mesh-inbox-rollout-gate.mjs";

const gate=fileURLToPath(new URL("../scripts/qa-mesh-inbox-rollout-gate.mjs",import.meta.url));
const baseMigrations=MIGRATIONS.filter(x=>x.kind==="base").map(({version,name})=>({version,name}));
const inboxMigrations=MIGRATIONS.filter(x=>x.kind==="inbox").map(({version,name})=>({version,name}));
const baseline=()=>({
  projectRef:PROJECT,
  migrations:baseMigrations.map(x=>({...x})),
  edgeFunctions:["mesh-device-enrollment"],
  database:{
    invites:0,resolved:0,discovered:2,trusted:0,owners:1,revoked:0,missingKeys:0,
    proofTable:0,dispatchColumn:0,resolutionColumn:0,
    directClientInviteSelect:true,serviceInviteUpdate:true,
    proofTableRls:false,proofTableClientWrite:false
  }
});
const staged=()=>{
 const x=baseline();
 x.migrations=[...baseMigrations,...inboxMigrations];
 x.edgeFunctions.push("mesh-inbox-send","mesh-inbox-receive");
 Object.assign(x.database,{
  proofTable:1,dispatchColumn:1,resolutionColumn:1,
  directClientInviteSelect:false,proofTableRls:true
 });
 return x;
};
const blocked=(snapshot:ReturnType<typeof baseline>,code:string,phase:"baseline"|"schema-staged"="baseline")=>{
 assert.throws(()=>validateSnapshot(snapshot,phase),
  error=>error instanceof Error&&error.message.includes("MESH_ROLLOUT_BLOCKED: "+code));
};

test("all six migrations exist and Stage2L/2O/2O.1 hashes match reviewed sources",()=>{
 const x=verifyLocalContract();
 assert.equal(x.versions.length,6);
 assert.ok(x.requiredFlags.length>=6);
});
test("live baseline gives review-only, never Mesh connection or deployment authority",()=>{
 const x=validateSnapshot(baseline());
 assert.equal(x.result,"BASELINE_MATCHES_REVIEW_ONLY");
 assert.equal(x.verifiedMigrations,0);
 assert.equal(x.connected,false);
 assert.equal(x.remoteJobsEnabled,false);
});
test("post-schema inventory checks strict service/RLS grants and presence of both Edges",()=>{
 const x=validateSnapshot(staged(),"schema-staged");
 assert.equal(x.result,"STAGED_SCHEMA_REVIEW_ONLY");
 assert.equal(x.verifiedMigrations,3);
 assert.equal(x.connected,false);
});
test("partial rollout, unexpected unreviewed schema and edge deployment fail closed",()=>{
 for(const version of inboxMigrations){
  const x=baseline();
  x.migrations.push(version);
  blocked(x,"PARTIALLY_DEPLOYED_INBOX");
 }
 const rogue=baseline();
 rogue.edgeFunctions.push("mesh-inbox-receive");
 blocked(rogue,"EDGE_ALREADY_PRESENT");
 const changed=baseline();
 changed.database.proofTable=1;
 blocked(changed,"BASELINE_SCHEMA_DRIFT");
});
test("post schema refuses missing Edge, wrong client grants or absent RLS",()=>{
 const noEdge=staged();noEdge.edgeFunctions.pop();
 blocked(noEdge,"INBOX_EDGE_NOT_DEPLOYED","schema-staged");
 const exposed=staged();exposed.database.directClientInviteSelect=true;
 blocked(exposed,"STAGED_SCHEMA_SECURITY_DRIFT","schema-staged");
 const noRls=staged();noRls.database.proofTableRls=false;
 blocked(noRls,"STAGED_SCHEMA_SECURITY_DRIFT","schema-staged");
 const write=staged();write.database.proofTableClientWrite=true;
 blocked(write,"STAGED_SCHEMA_SECURITY_DRIFT","schema-staged");
});
test("schema migration history cannot be falsified or out of order",()=>{
 const dup=baseline();dup.migrations.push({...dup.migrations[0]});
 blocked(dup,"INVALID_MIGRATION_HISTORY");
 const mismatch=baseline();mismatch.migrations[1]={...mismatch.migrations[1],name:"tampered"};
 blocked(mismatch,"MISSING_BASELINE_20261028202503");
 const wrong=baseline();wrong.projectRef="ffffffffffffffffffff";
 blocked(wrong,"WRONG_PROJECT");
});
test("refuse existing invites, trusted keys, unexpected owners and revoked devices",()=>{
 for(const [name,value] of [
  ["invites",1],["resolved",1],["trusted",1],
  ["discovered",3],["owners",2],["revoked",1],["missingKeys",1]
 ] as const){
  const x=baseline();
  x.database[name]=value;
  blocked(x,name==="invites"||name==="resolved"?
     "EXISTING_INVITES_REQUIRE_REVIEW":"DEVICE_REGISTRY_UNEXPECTED");
 }
 const x=baseline();x.database.serviceInviteUpdate=false;
 blocked(x,"EDGE_DATABASE_UPDATE_NOT_AUTHORIZED");
});
test("CLI never fetches network and requires explicitly supplied local JSON file",()=>{
 const missing=spawnSync(process.execPath,[gate],{encoding:"utf8",timeout:2000});
 assert.equal(missing.status,2);
 assert.match(missing.stderr,/MESH_ROLLOUT_BLOCKED/);
 const url=spawnSync(process.execPath,[gate,"--phase","baseline","--snapshot","https://example.com/private"],{
  encoding:"utf8",timeout:2000
 });
 assert.equal(url.status,2);
 assert.match(url.stderr,/LOCAL_SNAPSHOT_ONLY/);
 const folder=mkdtempSync(join(tmpdir(),"ksmesh-gate-"));
 try{
  const name=join(folder,"base.json");
  writeFileSync(name,JSON.stringify(baseline()));
  const result=spawnSync(process.execPath,[gate,"--phase","baseline","--snapshot",name],{
   encoding:"utf8",timeout:2000
  });
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).connected,false);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

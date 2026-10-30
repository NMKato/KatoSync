#!/usr/bin/env node
// Created by NMKato Solutions.
// Read-only, offline preflight for staged KatoSync Mesh inbox migrations.
// NEVER connects to Supabase, alters a DB, deploys an Edge function, or enables
// Mesh trust. Input is a reviewed, non-secret aggregate-only snapshot.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve, dirname, join} from "node:path";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
export const PROJECT="xbnnlyyxiilklsygxcof";
export const MIGRATIONS=[
  {version:"20261028202403",name:"katosync_mesh_owned_schema",kind:"base"},
  {version:"20261028202503",name:"katosync_add_to_existing_exposed_schemas",kind:"base"},
  {version:"20261028204216",name:"katosync_account_membership_admission",kind:"base"},
  {version:"20261029211243",name:"mesh_inbox_signed_send_guard",kind:"inbox",
   sha256:"0d52bf08fe93e32e53b3e284d6a0bfd8db68d38d475a44479fa082ad61225124"},
  {version:"20261030072543",name:"mesh_recipient_signed_inbox_atomic_decisions",kind:"inbox",
   sha256:"ca57d61435f7f3620ec2f311d93a188210ef12d25ac7a520f74b781ac634197e"},
  {version:"20261030074910",name:"mesh_resolution_proof_binding",kind:"inbox",
   sha256:"cd1b2e9c1e52b28e7012f4cccaf5ce193c5f6e317ee190e28e272d4d5bab8281"},
  {version:"20261030093323",name:"mesh_inbox_recipient_key_continuity",kind:"inbox",
   sha256:"358beec0cab70d43065428a4627d2888b22b9f85c5e858fdb32e01c322cbf361"},
];
const REQUIRED_ROLLOUT_FLAGS=[
 "KATOSYNC_MESH_INBOX_STAGE=send-only", // Edge only, after schema.
 "KATOSYNC_MESH_INBOX_RECEIVE_STAGE=qa-inbox",
 "KATOSYNC_MESH_INBOX_SEND_QA=1", // Rust compile-time only.
 "KATOSYNC_MESH_INBOX_RECEIVE_QA=1",
 "VITE_MESH_INBOX_SEND_QA=1", // UI QA only.
 "VITE_MESH_INBOX_RECEIVE_QA=1",
];
function fail(code){throw new Error("MESH_ROLLOUT_BLOCKED: "+code);}
function isNonnegativeSafeInt(n){return Number.isSafeInteger(n)&&n>=0;}
export function verifyLocalContract(root=ROOT){
  for(const item of MIGRATIONS){
    const filename=join(root,"supabase","migrations",item.version+"_"+item.name+".sql");
    let data;
    try{data=readFileSync(filename);}catch{fail("MISSING_MIGRATION_"+item.version);}
    if(item.sha256&&createHash("sha256").update(data).digest("hex")!==item.sha256)
      fail("MIGRATION_HASH_CHANGED_"+item.version);
  }
  const send=readFileSync(join(root,"supabase/functions/mesh-inbox-send/send.ts"),"utf8");
  const receive=readFileSync(join(root,"supabase/functions/mesh-inbox-receive/receive.ts"),"utf8");
  const sendIndex=readFileSync(join(root,"supabase/functions/mesh-inbox-send/index.ts"),"utf8");
  const receiveIndex=readFileSync(join(root,"supabase/functions/mesh-inbox-receive/index.ts"),"utf8");
  const rustSend=readFileSync(join(root,"src-tauri/src/mesh_inbox.rs"),"utf8");
  const rustReceive=readFileSync(join(root,"src-tauri/src/mesh_inbox_receiver.rs"),"utf8");
  const ui=readFileSync(join(root,"src/components/MeshConnectionCard.tsx"),"utf8");
  if(!send.includes('"send-only"')||!receive.includes('"qa-inbox"')||
    !sendIndex.includes("KATOSYNC_MESH_INBOX_STAGE")||
    !receiveIndex.includes("KATOSYNC_MESH_INBOX_RECEIVE_STAGE")||
    !rustSend.includes('KATOSYNC_MESH_INBOX_SEND_QA')||
    !rustReceive.includes('KATOSYNC_MESH_INBOX_RECEIVE_QA')||
    !ui.includes('VITE_MESH_INBOX_SEND_QA')||
    !ui.includes('VITE_MESH_INBOX_RECEIVE_QA'))fail("QA_FLAGS_MISSING");
  if(!receive.includes("signing_public_key:device.signing_public_key")||
    !receive.includes("saved.signing_public_key!==device.signing_public_key")||
    !receive.includes("resolution_proof_id:saved.proof_id")||
    !receive.includes("paired:false")||!send.includes("paired:false"))
    fail("PROOF_OR_NONTRUST_RESPONSE_MISSING");
  return Object.freeze({versions:MIGRATIONS.map(x=>x.version),requiredFlags:REQUIRED_ROLLOUT_FLAGS});
}
export function validateSnapshot(raw,phase="baseline"){
 if(phase!=="baseline"&&phase!=="schema-staged")fail("INVALID_PHASE");
 if(!raw||typeof raw!=="object"||Array.isArray(raw))fail("INVALID_SNAPSHOT");
 if(raw.projectRef!==PROJECT)fail("WRONG_PROJECT");
 if(!Array.isArray(raw.migrations)||raw.migrations.length<3||
    raw.migrations.length>300)fail("MIGRATION_HISTORY_UNAVAILABLE");
 const versionMap=new Map();
 for(const m of raw.migrations){
  if(!m||typeof m!=="object"||typeof m.version!=="string"||
     !/^\d{14}$/.test(m.version)||typeof m.name!=="string"||
     m.name.length>128||versionMap.has(m.version))fail("INVALID_MIGRATION_HISTORY");
  versionMap.set(m.version,m.name);
 }
 for(const m of MIGRATIONS.filter(x=>x.kind==="base"))
  if(versionMap.get(m.version)!==m.name)fail("MISSING_BASELINE_"+m.version);
 const applied=MIGRATIONS.filter(x=>x.kind==="inbox"&&versionMap.has(x.version));
 if(applied.some(x=>versionMap.get(x.version)!==x.name))fail("MIGRATION_NAME_DRIFT");
 if(phase==="baseline"&&applied.length!==0)fail("PARTIALLY_DEPLOYED_INBOX");
 if(phase==="schema-staged"&&applied.length!==MIGRATIONS.filter(x=>x.kind==="inbox").length)
   fail("INCOMPLETE_SCHEMA_STAGE");
 if(applied.length>0&&applied.length<MIGRATIONS.filter(x=>x.kind==="inbox").length)
   fail("PARTIALLY_DEPLOYED_INBOX");
 if(!Array.isArray(raw.edgeFunctions)||raw.edgeFunctions.length>200||
    raw.edgeFunctions.some(x=>typeof x!=="string"||x.length>100))fail("EDGE_INVENTORY_UNAVAILABLE");
 const edges=new Set(raw.edgeFunctions);
 if(!edges.has("mesh-device-enrollment"))fail("ENROLLMENT_EDGE_MISSING");
 const sendLive=edges.has("mesh-inbox-send"),receiveLive=edges.has("mesh-inbox-receive");
 if(phase==="baseline"&&(sendLive||receiveLive))fail("EDGE_ALREADY_PRESENT");
 if(phase==="schema-staged"&&(!sendLive||!receiveLive))
   fail("INBOX_EDGE_NOT_DEPLOYED");
 const db=raw.database;
 if(!db||typeof db!=="object"||Array.isArray(db))fail("DATABASE_PREFLIGHT_MISSING");
 for(const name of ["invites","resolved","discovered","trusted","owners","revoked",
   "missingKeys","proofTable","dispatchColumn","resolutionColumn","proofKeyColumn"])
  if(!isNonnegativeSafeInt(db[name]))fail("INVALID_DB_VALUE_"+name);
 for(const name of ["directClientInviteSelect","serviceInviteUpdate",
   "proofTableRls","proofTableClientWrite","proofKeyConstraint",
   "proofKeyInsertTrigger","proofKeyResolutionTrigger"])
  if(typeof db[name]!=="boolean")fail("INVALID_DB_PERMISSION_"+name);
 if(db.invites!==0||db.resolved!==0)fail("EXISTING_INVITES_REQUIRE_REVIEW");
 if(db.discovered!==2||db.owners!==1||db.trusted!==0||
    db.revoked!==0||db.missingKeys!==0)fail("DEVICE_REGISTRY_UNEXPECTED");
 if(!db.serviceInviteUpdate)fail("EDGE_DATABASE_UPDATE_NOT_AUTHORIZED");
 if(phase==="baseline"){
  if(db.proofTable!==0||db.dispatchColumn!==0||db.resolutionColumn!==0||
     db.proofKeyColumn!==0||db.proofKeyConstraint||db.proofKeyInsertTrigger||
     db.proofKeyResolutionTrigger||!db.directClientInviteSelect)
    fail("BASELINE_SCHEMA_DRIFT");
 }else{
  if(db.proofTable!==1||db.dispatchColumn!==1||db.resolutionColumn!==1||
     db.proofKeyColumn!==1||!db.proofKeyConstraint||
     !db.proofKeyInsertTrigger||!db.proofKeyResolutionTrigger||
     db.directClientInviteSelect||!db.proofTableRls||db.proofTableClientWrite)
    fail("STAGED_SCHEMA_SECURITY_DRIFT");
 }
 return {phase,projectRef:PROJECT,
   result:phase==="baseline"?"BASELINE_MATCHES_REVIEW_ONLY":"STAGED_SCHEMA_REVIEW_ONLY",
   discovered:db.discovered,invites:db.invites,
   trusted:db.trusted,verifiedMigrations:applied.length,
   remoteSessionReady:false,remoteJobsEnabled:false,connected:false,
   notice:"This is an OFFLINE read-only snapshot check, never deployment authorization."};
}
export function run(argv=process.argv.slice(2),root=ROOT){
 const valid=argv.length===4&&argv[0]==="--phase"&&argv[2]==="--snapshot";
 if(!valid)fail("USAGE_--phase_baseline|schema-staged_--snapshot_/path/to/aggregate.json");
 const phase=argv[1];const input=argv[3];
 // Never reach out to a URL; only read a supplied local JSON file.
 if(/^https?:\/\//i.test(input)||input.length>512)fail("LOCAL_SNAPSHOT_ONLY");
 verifyLocalContract(root);
 let data;try{const text=readFileSync(input,"utf8");if(text.length>65536)fail("SNAPSHOT_TOO_LARGE");data=JSON.parse(text);}
 catch(err){if(String(err).includes("MESH_ROLLOUT_BLOCKED"))throw err;fail("SNAPSHOT_UNAVAILABLE");}
 return validateSnapshot(data,phase);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=run();
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
 }catch(error){
  process.stderr.write(String(error.message??error)+"\n");
  process.exitCode=2;
 }
}

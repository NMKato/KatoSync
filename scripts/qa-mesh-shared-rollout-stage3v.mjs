#!/usr/bin/env node
// Stage 3V: offline-only review gate for shared KATOOS/katosync namespace.
// No Supabase client, network, secrets, migrations or Edge deployment.
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const PROJECT="xbnnlyyxiilklsygxcof";
const BASE=[
 ["20261028202403","katosync_mesh_owned_schema","c2dc516c96367c78f559118f62f47eaf9cb24d6b2149483ddddd6b7377f8059d"],
 ["20261028202503","katosync_add_to_existing_exposed_schemas","842a42912fcae0dbedecf0f09decd9d687010be13a98785b99085df3711c029f"],
 ["20261028204216","katosync_account_membership_admission","afb11c474aca8ad87ee24d72c5aebed1f11a2980cb3a0eca7fd7496a2dea291c"],
];
const PENDING=[
 ["20261029211243","mesh_inbox_signed_send_guard","0d52bf08fe93e32e53b3e284d6a0bfd8db68d38d475a44479fa082ad61225124"],
 ["20261030072543","mesh_recipient_signed_inbox_atomic_decisions","ca57d61435f7f3620ec2f311d93a188210ef12d25ac7a520f74b781ac634197e"],
 ["20261030074910","mesh_resolution_proof_binding","cd1b2e9c1e52b28e7012f4cccaf5ce193c5f6e317ee190e28e272d4d5bab8281"],
 ["20261030093323","mesh_inbox_recipient_key_continuity","358beec0cab70d43065428a4627d2888b22b9f85c5e858fdb32e01c322cbf361"],
 ["20261031213900","mesh_pairing_relay_staged","7b834ad933c94623045c04f4b79d33ed36306b55f3a94a218bf8f811b9d1eb72"],
];
export const expectedMigrations=Object.freeze({base:BASE,pending:PENDING});
const deny=reason=>{throw new Error("STAGE3V_ROLLOUT_BLOCKED:"+reason)};
export function checkPinnedFiles(root=ROOT){
  for(const [version,name,sha] of [...BASE,...PENDING]){
    const path=join(root,"supabase","migrations",version+"_"+name+".sql");
    let bytes;
    try{bytes=readFileSync(path)}catch{deny("MISSING_"+version)}
    // Windows checkout may convert LF to CRLF; pin canonical SQL contents,
    // never platform-specific checkout byte layouts.
    const canonical=bytes.toString("utf8").replace(/\r\n/g,"\n");
    if(canonical.includes("\r")||(sha&&createHash("sha256").update(canonical,"utf8").digest("hex")!==sha))
      deny("DRIFT_"+version);
  }
  const runner=readFileSync(join(root,"scripts/qa-mesh-postgres-local.sh"),"utf8");
  const sql=readFileSync(join(root,"tests/sql/mesh_stage3v_shared_schema_compat.sql"),"utf8");
  if(!runner.includes('shared-rollout) TEST_FILE=')||
     !sql.includes("STAGE3V_SHARED_KATOOS_SCHEMA_COMPAT_PASS")||
     !sql.includes("SET ROLE authenticated;")||
     !sql.includes("MESH_RELAY_LOCAL_SQL_SECURITY_PASS") && !sql.includes("mesh_pairing_relay_qa.sql"))
    deny("LOCAL_SQL_QA_REQUIRED");
  return true;
}
const REQUIRED_TABLES=[
 "account_memberships","mesh_devices","mesh_enrollment_challenges",
 "mesh_invites","mesh_owner_policy"
];
export function validatePreRolloutSnapshot(s){
 if(!s||typeof s!=="object"||Array.isArray(s)||s.projectRef!==PROJECT)
   deny("WRONG_PROJECT");
 if(!Array.isArray(s.migrations)||s.migrations.length<3||s.migrations.length>500)
   deny("MIGRATION_HISTORY_INVALID");
 const versions=new Map();
 for(const record of s.migrations){
   if(typeof record?.version!=="string"||!/^\d{14}$/.test(record.version)||
      typeof record?.name!=="string"||versions.has(record.version))deny("MIGRATION_HISTORY_DRIFT");
   versions.set(record.version,record.name);
 }
 for(const [id,name] of BASE)if(versions.get(id)!==name)deny("BASELINE_MISSING_"+id);
 for(const [id] of PENDING)if(versions.has(id))deny("PARTIAL_OR_PRIOR_DEPLOYMENT_"+id);
 if(!Array.isArray(s.tables)||s.tables.length!==REQUIRED_TABLES.length||
    REQUIRED_TABLES.some(name=>!s.tables.includes(name))||
    new Set(s.tables).size!==s.tables.length)deny("UNEXPECTED_SCHEMA_TABLES");
 if(!s.counts||!Number.isSafeInteger(s.counts.invites)||s.counts.invites!==0)
    deny("NONEMPTY_INVITATIONS_REQUIRE_REVIEW");
 for(const k of ["devices","trusted","revoked","memberships"]){
   if(!Number.isSafeInteger(s.counts[k])||s.counts[k]<0)deny("INVALID_COUNT_"+k);
 }
 if(s.counts.trusted!==0||s.counts.revoked!==0||s.counts.devices>10)
   deny("DEVICE_TRUST_OR_QUOTA_REVIEW");
 const checks=s.permissions;
 if(!checks||checks.anonSchemaUsage!==false||
    checks.anonInviteSelect!==false||
    checks.authInviteSelect!==true||
    checks.authMembershipSelect!==true||
    checks.authDevicesSelect!==true||
    checks.serverInviteInsert!==true)deny("BASELINE_GRANTS_MISMATCH");
 if(s.dispatchColumn!==false||s.proofTable!==false||
    s.relayMessagesTable!==false||s.relayReadsTable!==false)
    deny("PARTIAL_SCHEMA_DEPLOYMENT");
 if(!Array.isArray(s.edgeFunctions)||!s.edgeFunctions.includes("mesh-device-enrollment")||
    s.edgeFunctions.some(x=>["mesh-inbox-send","mesh-inbox-receive","mesh-pairing-relay"].includes(x)))
    deny("EDGE_ROLLOUT_STATE_MISMATCH");
 return Object.freeze({status:"SCHEMA_PREFLIGHT_ONLY",migrationCount:PENDING.length,canDeployAutomatically:false});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  checkPinnedFiles();
  if(!process.argv[2]){console.log("STAGE3V_PINNED_LOCAL_FILES_OK");process.exit(0)}
  const snapshot=JSON.parse(readFileSync(resolve(process.argv[2]),"utf8"));
  console.log(validatePreRolloutSnapshot(snapshot));
}

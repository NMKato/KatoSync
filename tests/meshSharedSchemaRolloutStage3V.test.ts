// Stage 3V: no database connections, all input is aggregate-only synthetic.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkPinnedFiles,validatePreRolloutSnapshot,expectedMigrations}
  from "../scripts/qa-mesh-shared-rollout-stage3v.mjs";
const baseline=()=>({
 projectRef:"xbnnlyyxiilklsygxcof",
 migrations:expectedMigrations.base.map(([version,name])=>({version,name})),
 tables:["account_memberships","mesh_devices","mesh_enrollment_challenges","mesh_invites","mesh_owner_policy"],
 counts:{invites:0,devices:2,trusted:0,revoked:0,memberships:1},
 permissions:{anonSchemaUsage:false,anonInviteSelect:false,
  authInviteSelect:true,authMembershipSelect:true,authDevicesSelect:true,
  serverInviteInsert:true},
 dispatchColumn:false,proofTable:false,
 relayMessagesTable:false,relayReadsTable:false,
 edgeFunctions:["mesh-device-enrollment"]
});
test("Stage 3V pinned five migration files and local SQL-mode are unchanged",()=>{
 assert.equal(checkPinnedFiles(),true);
 assert.equal(expectedMigrations.pending.length,5);
 const file=readFileSync(new URL("../scripts/qa-mesh-postgres-local.sh",import.meta.url),"utf8");
 assert.match(file,/listen_addresses=''|listen_addresses=\\?''/);
 assert.match(file,/shared-rollout\) TEST_FILE=/);
});
test("Expected shared KATOOS baseline authorizes review only, never auto rollout",()=>{
 assert.deepEqual(validatePreRolloutSnapshot(baseline()),{
   status:"SCHEMA_PREFLIGHT_ONLY",migrationCount:5,canDeployAutomatically:false
 });
});
test("Reject tenant confusion, partially applied migrations and unexpected schema",()=>{
 const badProject=baseline();badProject.projectRef="fsfxjlzvmjtkhjmscftf";
 assert.throws(()=>validatePreRolloutSnapshot(badProject),/WRONG_PROJECT/);
 const partial=baseline();partial.migrations.push({
   version:expectedMigrations.pending[0][0],name:expectedMigrations.pending[0][1]});
 assert.throws(()=>validatePreRolloutSnapshot(partial),/PARTIAL_OR_PRIOR_DEPLOYMENT/);
 const unexpected=baseline();unexpected.tables.push("unknown");
 assert.throws(()=>validatePreRolloutSnapshot(unexpected),/UNEXPECTED_SCHEMA_TABLES/);
});
test("Deny live invitations, trusted peers, privilege drift and server rollout",()=>{
 const invitations=baseline();invitations.counts.invites=1;
 assert.throws(()=>validatePreRolloutSnapshot(invitations),/NONEMPTY_INVITATIONS/);
 const peers=baseline();peers.counts.trusted=1;
 assert.throws(()=>validatePreRolloutSnapshot(peers),/DEVICE_TRUST_OR_QUOTA/);
 const anon=baseline();anon.permissions.anonSchemaUsage=true;
 assert.throws(()=>validatePreRolloutSnapshot(anon),/BASELINE_GRANTS_MISMATCH/);
 const write=baseline();write.permissions.serverInviteInsert=false;
 assert.throws(()=>validatePreRolloutSnapshot(write),/BASELINE_GRANTS_MISMATCH/);
 const staged=baseline();staged.proofTable=true;
 assert.throws(()=>validatePreRolloutSnapshot(staged),/PARTIAL_SCHEMA_DEPLOYMENT/);
 const cloud=baseline();cloud.edgeFunctions.push("mesh-inbox-send");
 assert.throws(()=>validatePreRolloutSnapshot(cloud),/EDGE_ROLLOUT_STATE_MISMATCH/);
});
test("Stage 3V local SQL proves owner RLS, no user inbox and no remote jobs",()=>{
 const sql=readFileSync(new URL("./sql/mesh_stage3v_shared_schema_compat.sql",import.meta.url),"utf8");
 for(const part of ["mesh_pairing_relay_qa.sql","account_memberships",
     "SET ROLE authenticated;","STAGE3V_OTHER_OWNER_LEAK",
     "STAGE3V_UNAUTHORIZED_OWNER_LEAK","STAGE3V_CLIENT_SELF_PROMOTION_OR_REVOKE_OPEN",
     "STAGE3V_SHARED_KATOOS_SCHEMA_COMPAT_PASS"])assert.ok(sql.includes(part),part);
 assert.doesNotMatch(sql,/ALTER\s+TABLE\s+public\./i);
});

test("Canonical migration hash accepts Windows CRLF but rejects tampered SQL",async()=>{
 const fs=await import("node:fs");
 const os=await import("node:os");
 const path=await import("node:path");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"katosync-stage3v-"));
 const source=new URL("../",import.meta.url);
 try{
  for(const [version,name] of [...expectedMigrations.base,...expectedMigrations.pending]){
   const relative=(expectedMigrations.pending.some(x=>x[0]===version)?"tests/fixtures/migrations/":"supabase/migrations/")+version+"_"+name+".sql";
   const target=path.join(root,relative);
   fs.mkdirSync(path.dirname(target),{recursive:true});
   const original=fs.readFileSync(new URL("../"+relative,import.meta.url),"utf8");
   fs.writeFileSync(target,original.replace(/\r\n/g,"\n").replace(/\n/g,"\r\n"));
  }
  for(const relative of ["scripts/qa-mesh-postgres-local.sh",
     "tests/sql/mesh_stage3v_shared_schema_compat.sql"]){
   const target=path.join(root,relative);
   fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.copyFileSync(new URL("../"+relative,import.meta.url),target);
  }
  assert.equal(checkPinnedFiles(root),true);
  const [version,name]=expectedMigrations.pending[4];
  const file=path.join(root,"tests/fixtures/migrations/"+version+"_"+name+".sql");
  fs.appendFileSync(file,"\r\n-- unauthorized change\r\n");
  assert.throws(()=>checkPinnedFiles(root),/STAGE3V_ROLLOUT_BLOCKED:DRIFT_/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

// NMKato Solutions – Stage 2Y backup inventory only, no real cloud in CI.
import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {reviewBackups,runCli,PROJECT} from "../scripts/qa-mesh-backup-readiness.mjs";
const command=fileURLToPath(new URL("../scripts/qa-mesh-backup-readiness.mjs",import.meta.url));
const NOW=new Date("2026-10-30T12:18:00Z");
const fixture=()=>({
 region:"eu-central-1",walg_enabled:true,pitr_enabled:false,
 backups:[
  {id:1,is_physical_backup:true,status:"COMPLETED",inserted_at:"2026-10-30T06:07:00.187Z"},
  {id:2,is_physical_backup:true,status:"COMPLETED",inserted_at:"2026-10-29T06:07:01.910Z"},
  {id:3,is_physical_backup:true,status:"IN_PROGRESS",inserted_at:"2026-10-30T09:00:00Z"}
 ]
});
test("real observed daily backup shape is recognized but NEVER grants restore or deployment",()=>{
 const out=reviewBackups(fixture(),NOW);
 assert.equal(out.result,"COMPLETED_BACKUP_INVENTORY_RESTORE_UNTESTED");
 assert.equal(out.projectRef,PROJECT);
 assert.equal(out.latestCompletedPhysicalBackup,"2026-10-30T06:07:00.187Z");
 assert.equal(out.completedPhysicalBackups,2);
 assert.equal(out.pointInTimeRecoveryEnabled,false);
 assert.equal(out.walArchivingEnabled,true);
 assert.equal(out.latestBackupAgeMinutes,371);
 for(const key of ["restoreTested","recoveryReady","operatorApproval","authorizedToDeploy",
  "trustEnabled","remoteJobsEnabled"]as const)assert.equal(out[key],false);
 assert.equal(out.approvedRpoMinutes,null);
 assert.equal(out.approvedRtoMinutes,null);
 assert.ok(!JSON.stringify(out).includes('"id":'));
});
test("daily backup inventory refuses wrong region, no complete physical backup, stale/future entries",()=>{
 const changes=[
  [x=>{x.region="us-east-1"},"REGION_MISMATCH"],
  [x=>{x.pitr_enabled="no"},"RECOVERY_FLAGS_UNAVAILABLE"],
  [x=>{x.backups=[]},"NO_BACKUP_LIST"],
  [x=>{x.backups=x.backups.map(b=>({...b,status:"FAILED"}))},"NO_COMPLETED_PHYSICAL_BACKUP"],
  [x=>{x.backups=x.backups.map(b=>({...b,is_physical_backup:false}))},"NO_COMPLETED_PHYSICAL_BACKUP"],
  [x=>{x.backups[0].inserted_at="2026-10-28T00:00:00Z";
        x.backups[1].inserted_at="2026-10-28T01:00:00Z"},"LATEST_BACKUP_STALE"],
  [x=>{x.backups[0].inserted_at="2026-10-31T00:00:00Z"},"BACKUP_TIMESTAMP_INVALID"],
  [x=>{x.backups[1].id=x.backups[0].id},"INVALID_BACKUP_RECORD"]
 ]as const;
 for(const [change,reason]of changes){
  const x=fixture();change(x);
  assert.throws(()=>reviewBackups(x,NOW),new RegExp(reason));
 }
});
test("PITR is reported from API flags, never inferred from WAL presence",()=>{
 const x=fixture();x.pitr_enabled=true;x.walg_enabled=false;
 const r=reviewBackups(x,NOW);
 assert.equal(r.pointInTimeRecoveryEnabled,true);
 assert.equal(r.walArchivingEnabled,false);
 assert.equal(r.recoveryReady,false);
});
test("CLI is invoked only with one literal read-only backups-list command",()=>{
 let calls=0;
 const x=runCli({now:NOW,spawn:(cmd,args,options)=>{
  ++calls;
  assert.equal(cmd,"supabase");
  assert.deepEqual(args,["backups","list","--project-ref",PROJECT,"--output-format","json"]);
  assert.equal(options.shell,false);
  assert.equal(options.cwd,tmpdir(),"Never create Supabase CLI cache inside checkout");
  assert.ok(!args.includes("restore")&&!args.includes("--yes"));
  return {status:0,stdout:JSON.stringify(fixture())};
 }});
 assert.equal(calls,1);
 assert.equal(x.completedPhysicalBackups,2);
});
test("unavailable CLI or invalid JSON fails closed and never falls back to a guessed backup",()=>{
 for(const value of [
  {status:1,stdout:""},
  {status:0,stdout:""},
  {status:0,stdout:"not-json"}
 ]){
  assert.throws(()=>runCli({spawn:()=>value,now:NOW}),
    /MESH_BACKUP_READINESS_BLOCKED: CLI_/);
 }
});
test("direct invocation refuses missing or extra options before Supabase CLI",()=>{
 const a=spawnSync(process.execPath,[command],{encoding:"utf8",timeout:3000});
 assert.equal(a.status,2);
 assert.match(a.stderr,/EXPLICIT_LIVE_READ_ONLY_REQUIRED/);
 const b=spawnSync(process.execPath,[command,"--restore","--yes"],{
  encoding:"utf8",timeout:3000
 });
 assert.equal(b.status,2);
 assert.match(b.stderr,/EXPLICIT_LIVE_READ_ONLY_REQUIRED/);
});

#!/usr/bin/env node
// NMKato Solutions — Stage 2Y. Independent, READ-ONLY backup inventory.
// Never restores, downloads, creates a branch, applies SQL, deploys Edge, or
// handles API keys itself. Supabase CLI's own auth is read-only for this call.
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
export const PROJECT="xbnnlyyxiilklsygxcof";
export const EXPECTED_REGION="eu-central-1";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const MINUTE=60_000, MAX_AGE=36*60*MINUTE;
const fail=code=>{throw Error("MESH_BACKUP_READINESS_BLOCKED: "+code);};

export function reviewBackups(raw,now=new Date()){
 const timestamp=now instanceof Date?now.getTime():NaN;
 if(!Number.isFinite(timestamp))fail("INVALID_NOW");
 if(!raw||typeof raw!=="object"||Array.isArray(raw))fail("INVENTORY_MISSING");
 if(raw.region!==EXPECTED_REGION)fail("REGION_MISMATCH");
 if(typeof raw.pitr_enabled!=="boolean"||typeof raw.walg_enabled!=="boolean")
    fail("RECOVERY_FLAGS_UNAVAILABLE");
 if(!Array.isArray(raw.backups)||raw.backups.length===0||raw.backups.length>100)
    fail("NO_BACKUP_LIST");
 const seen=new Set(),backups=[];
 for(const b of raw.backups){
  if(!b||typeof b!=="object"||Array.isArray(b)||
     !Number.isSafeInteger(b.id)||b.id<=0||seen.has(b.id)||
     typeof b.inserted_at!=="string"||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(b.inserted_at)||
     typeof b.is_physical_backup!=="boolean"||typeof b.status!=="string")
      fail("INVALID_BACKUP_RECORD");
  const when=Date.parse(b.inserted_at);
  if(!Number.isFinite(when)||when>timestamp+MINUTE)fail("BACKUP_TIMESTAMP_INVALID");
  seen.add(b.id);
  if(b.status==="COMPLETED"&&b.is_physical_backup)
    backups.push({when,iso:new Date(when).toISOString()});
 }
 if(!backups.length)fail("NO_COMPLETED_PHYSICAL_BACKUP");
 backups.sort((a,b)=>b.when-a.when);
 const latest=backups[0],age=timestamp-latest.when;
 if(age<0||age>MAX_AGE)fail("LATEST_BACKUP_STALE");
 // A COMPLETED snapshot in inventory != a tested restore, guaranteed RPO,
 // PITR retention window, owner approval, or deployment authorization.
 return Object.freeze({
  result:"COMPLETED_BACKUP_INVENTORY_RESTORE_UNTESTED",
  projectRef:PROJECT,region:EXPECTED_REGION,
  checkedAt:new Date(timestamp).toISOString(),
  latestCompletedPhysicalBackup:latest.iso,
  completedPhysicalBackups:backups.length,
  oldestListedCompletedPhysicalBackup:backups.at(-1).iso,
  latestBackupAgeMinutes:Math.ceil(age/MINUTE),
  pointInTimeRecoveryEnabled:raw.pitr_enabled,
  walArchivingEnabled:raw.walg_enabled,
  restoreTested:false, recoveryReady:false, approvedRpoMinutes:null,
  approvedRtoMinutes:null, operatorApproval:false,
  authorizedToDeploy:false, trustEnabled:false,
  remoteJobsEnabled:false
 });
}
export function runCli({command="supabase",spawn=spawnSync,now=new Date()}={}){
 const result=spawn(command,
  ["backups","list","--project-ref",PROJECT,"--output-format","json"],
  {cwd:tmpdir(),encoding:"utf8",timeout:15000,maxBuffer:1024*1024,shell:false});
 if(result.error||result.status!==0||typeof result.stdout!=="string"||
    result.stdout.length>512*1024)fail("CLI_INVENTORY_UNAVAILABLE");
 let inventory;
 try{inventory=JSON.parse(result.stdout);}
 catch{fail("CLI_JSON_INVALID");}
 return reviewBackups(inventory,now);
}
export function main(argv=process.argv.slice(2)){
 if(argv.length!==1||argv[0]!=="--live-read-only")
   fail("EXPLICIT_LIVE_READ_ONLY_REQUIRED");
 return runCli();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.stdout.write(JSON.stringify(main(),null,2)+"\n");}
 catch(e){process.stderr.write(String(e?.message??e)+"\n");process.exitCode=2;}
}

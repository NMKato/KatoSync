// Created by NMKato Solutions. Stage 3W recovery proof remains synthetic only.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {reviewBackups} from "../scripts/qa-mesh-backup-readiness.mjs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const shell=read("scripts/qa-mesh-shared-restore-stage3w.sh");
const digest=read("tests/sql/mesh_stage3w_recovery_integrity.sql");
test("Stage 3W backup inventory is read-only and cannot authorize deployment",()=>{
 const source=read("scripts/qa-mesh-backup-readiness.mjs");
 assert.match(source,/\["backups","list","--project-ref",PROJECT,"--output-format","json"\]/);
 assert.match(source,/authorizedToDeploy:false/);
 assert.match(source,/restoreTested:false/);
 const now=new Date("2026-11-02T12:44:32Z");
 const inv=reviewBackups({region:"eu-central-1",pitr_enabled:false,walg_enabled:true,
  backups:[{id:1,inserted_at:"2026-11-02T06:07:09.633Z",
   status:"COMPLETED",is_physical_backup:true}]},now);
 assert.equal(inv.pointInTimeRecoveryEnabled,false);
 assert.equal(inv.recoveryReady,false);
 assert.equal(inv.authorizedToDeploy,false);
});
test("Stage 3W refuses any operation without disposable-only opt-in",()=>{
 assert.match(shell,/SYNTHETIC_UNIX_SOCKET_ONLY/);
 assert.match(shell,/\$#.*-ne 0/);
 assert.match(shell,/mktemp -d \/tmp\/ksmeshqa/);
 assert.match(shell,/listen_addresses=''/);
 assert.match(shell,/127\.0\.0\.1/);
 assert.match(shell,/trap cleanup EXIT INT TERM/);
 assert.doesNotMatch(shell,/supabase db push|supabase migration up|apply_migration|CREATE BRANCH/i);
});
test("Stage 3W backup and restore use same local socket with no cloud access",()=>{
 assert.match(shell,/\$BIN\/pg_dump|\$BIN"\/pg_dump/);
 assert.match(shell,/\$BIN\/pg_restore|\$BIN"\/pg_restore/);
 assert.match(shell,/--format=custom/);
 assert.match(shell,/--exit-on-error/);
 assert.match(shell,/STAGE3W_EIGHT_TABLE_DATA_FINGERPRINT_MATCH/);
 assert.match(shell,/STAGE3W_FULL_EIGHT_TABLES_DISPOSABLE_RESTORE_PASS/);
});
test("Stage 3W digest covers exactly eight separate KatoSync tables",()=>{
 const tables=[
 "account_memberships","mesh_devices","mesh_enrollment_challenges","mesh_invites",
 "mesh_owner_policy","mesh_inbox_proofs",
 "mesh_pairing_relay_messages","mesh_pairing_relay_reads"
 ];
 for(const table of tables)
   assert.match(digest,new RegExp("FROM katosync\\."+table+" x"));
 assert.equal((digest.match(/FROM katosync\./g)||[]).length,8);
 assert.match(shell,/digest recovered/);
 assert.match(shell,/digest postgres/);
 assert.match(shell,/STAGE3W_RESTORED_DATA_UNCHANGED_AFTER_SOURCE_MUTATION/);
});
test("Restored roles, triggers and owner-isolation are rechecked",()=>{
 for(const sentinel of ["STAGE3W_EIGHT_RLS_TABLES_NOT_RESTORED",
  "STAGE3W_RESTORED_ROLE_PRIVILEGES_WRONG","STAGE3W_PROTECTION_TRIGGERS_MISSING",
  "STAGE3W_RESTORED_OWNER_RLS_FAILED","STAGE3W_RESTORED_FOREIGN_RLS_FAILED",
  "STAGE3W_RESTORED_EXTERNAL_EXTENSION"])
  assert.ok(shell.includes(sentinel),sentinel);
 assert.match(shell,/SET ROLE authenticated/);
 assert.match(shell,/STAGE3W_RESTORED_RLS_AND_ROLE_GATES_PASS/);
});

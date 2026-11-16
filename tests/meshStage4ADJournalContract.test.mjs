// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa/journal_qa.rs",import.meta.url),"utf8");
const parent=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa.rs",import.meta.url),"utf8");
const root=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const workflow=readFileSync(new URL("../.github/workflows/stage4ad-native-macos-qa.yml",import.meta.url),"utf8");
test("stage4ad is strictly internal beneath Stage4AC and the canonical QA-only lease",()=>{
 assert.match(root,/#\[cfg\(feature = "stage4j-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_durable_lease_qa;/);
 assert.match(parent,/mod journal_qa;/);
 assert.match(source,/use super::\{Candidate, SignedTask\}/);
 assert.doesNotMatch(source,/pub\s+(?:async\s+)?fn|#\[tauri::command\]|TcpListener|TcpStream|Command::new|std::process|tokio::spawn|while\s+true/);
});
test("durable local task id and nonce both reserved with O_EXCL-equivalent, fsync and strict root",()=>{
 for(const x of ["create_new(true)","sync_all()","symlink_metadata","InsecureRoot","task","nonce","AlreadyReserved","AlreadyExists"]){
  const alias=x==="AlreadyReserved"?"Duplicate":x;
  assert.ok(source.includes(alias),alias);
 }
 assert.match(source,/mode\(0o600\)/);
 assert.match(source,/mode\(\) & 0o077/);
 assert.match(source,/original|crash|partial/i);
});
test("candidate remains nonexecuting; no success receipt fabricated",()=>{
 for(const x of ["execution_authorized","requires_native_executor_recheck","maximum_output_bytes","InvalidCandidate"]){
  assert.ok(source.includes(x),x);
 }
 assert.doesNotMatch(source,/execution_authorized:\s*true/);
 assert.doesNotMatch(source,/"completed"|git rev-parse|finished_at|remote_jobs_enabled:\s*true/);
 assert.match(parent,/execution_authorized:\s*false/);
});
test("native journal tests include restart, concurrency, partial failure and unsafe filesystem",()=>{
 for(const x of ["survives_restart_and_rejects_same_ticket","reused_nonce_or_task_id_denied_after_restart",
 "concurrently_only_one_reserves","invalid_candidate_creates_no_records",
 "orphaned_marker_fail_closed_after_crash","symlink_and_insecure_directory_rejected"]){
   assert.ok(source.includes(x),x);
 }
});
test("dedicated macOS native regression has no production deploy/signed app",()=>{
 assert.match(workflow,/mesh_durable_lease_qa::signed_job_qa::journal_qa::tests/);
 assert.match(workflow,/tests\/meshStage4ADJournalContract.test.mjs/);
 assert.match(workflow,/cargo test --locked/);
 assert.match(workflow,/STAGE4AD_DURABLE_JOURNAL_QA_ONLY_NO_REMOTE/);
 assert.doesNotMatch(workflow,/wrangler deploy|supabase db push|cargo tauri build|codesign -s/);
});

// NMKato Solutions – Stage4AF QA-only execution-time fence contract.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../",import.meta.url);
const source=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa/execution_fence_qa.rs",import.meta.url),"utf8");
const parent=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa.rs",import.meta.url),"utf8");
const receipt=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa/receipt_qa.rs",import.meta.url),"utf8");
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const stage4l=readFileSync(new URL("../src-tauri/src/local_control/agent_scope.rs",import.meta.url),"utf8");
test("stage4af remains a private native QA child of isolated Stage4J feature",()=>{
 assert.match(parent,/mod execution_fence_qa;/);
 assert.match(lib,/#\[cfg\(feature = "stage4j-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_durable_lease_qa;/);
 const prefix=source.slice(0,source.indexOf("#[cfg(test)]"));
 assert.doesNotMatch(prefix,/std::process::Command|Command::new|TcpListener|TcpStream|tauri::command|pub fn|std::net/);
 assert.match(source,/#\[cfg\(test\)\]\s*fn qa_execute_git_head_and_store_receipt/);
});
test("executor fencing rechecks authenticated canonical Mesh and all owner scopes",()=>{
 for(const item of ["mesh.snapshot(now).live_peer_authenticated",
  "session.last_sequence","signed.signature","issuer.verify",
  "task.owner_id","task.tenant_id","task.owner_session_id",
  "task.client_id","task.project_id",
  "local_device_public_key","peer_device_public_key",
  "refreshed.independent_mfa_bound","refreshed.no_pending_revoke",
  "MAX_EXECUTION_RECHECK_AGE_MS","registered_root_matches",
  "candidate.requires_native_executor_recheck"]){
    assert.ok(source.includes(item),item);
 }
 assert.match(source,/refreshed.checked_at_ms\s*>\s*now_ms/);
 assert.match(source,/now_ms.saturating_sub\(refreshed.checked_at_ms\)/);
});
test("only exact test-created canonical project can run the fixed git HEAD read",()=>{
 assert.match(source,/Command::new\("git"\)/);
 assert.match(source,/\.args\(\["rev-parse",\s*"HEAD"\]\)/);
 assert.match(source,/\.current_dir\(&fence.registered_root\)/);
 assert.match(source,/\.stage4af-temporary-qa-only/);
 assert.match(source,/create_dir\(&project\)/);
 assert.match(source,/git\(&project,\s*&\["init",\s*"-q"\]\)/);
 assert.doesNotMatch(source,/git push|git fetch|git checkout|git reset|git clean|shell_command|bash -c/);
});
test("actual output needs device signature and durable receipt, not success flag",()=>{
 assert.match(source,/receipt_qa::sign_git_head_result/);
 assert.match(source,/receipt_qa::verify_receipt/);
 assert.match(source,/receipt_qa::persist_verified_receipt/);
 assert.match(receipt,/KatoSync-Stage4AE-device-git-head-receipt-v1/);
 assert.match(receipt,/expected_device\s*\.verify/);
});
test("negative native tests require post-admission revoke and no replay",()=>{
 for(const testName of [
  "real_temporary_git_head_requires_fresh_fence_and_signed_durable_result",
  "revoked_owner_or_device_or_queued_revoke_after_admission_denies_execution",
  "closed_lease_and_expired_heartbeat_stay_closed_even_with_valid_signature",
  "mismatched_owner_session_peer_project_or_issuer_never_pass",
  "stale_or_future_recheck_and_expired_signed_job_denied",
  "unknown_registry_root_or_symlink_never_read",
  "changed_git_head_after_admission_cannot_create_receipt",
  "fixture_runner_never_accepts_missing_qa_marker_or_changed_fence_time"
 ])assert.ok(source.includes(testName),testName);
});
test("the Stage4L production local-only boundary remains unchanged",()=>{
 assert.ok(stage4l.includes("STAGE4L_HEAD_CHANGED"));
 assert.ok(stage4l.includes("STAGE4L_PROJECT_MISMATCH"));
 assert.ok(stage4l.includes("agent_read_only"));
 assert.match(stage4l,/source[^\\n]{0,75}local|local[^\\n]{0,75}source/);
});

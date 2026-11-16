// Created by NMKato Solutions. Stage4AE source-only policy regression.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const receipt=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa/receipt_qa.rs",import.meta.url),"utf8");
const parent=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa.rs",import.meta.url),"utf8");
const journal=readFileSync(new URL("../src-tauri/src/mesh_durable_lease_qa/signed_job_qa/journal_qa.rs",import.meta.url),"utf8");
const workflow=readFileSync(new URL("../.github/workflows/stage4ae-native-macos-qa.yml",import.meta.url),"utf8");
const lib=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");

test("QA-only native child with zero runtime shell, network or exposed IPC",()=>{
 assert.match(parent,/mod receipt_qa;/);
 assert.match(lib,/#\[cfg\(feature = "stage4j-qa"\)\]\s*#\[allow\(dead_code\)\]\s*mod mesh_durable_lease_qa;/);
 assert.doesNotMatch(receipt.slice(0,receipt.indexOf("#[cfg(test)]")),
  /Command::new|std::process::Command|TcpStream|TcpListener|tauri::command|pub fn/);
 assert.ok(receipt.includes("#[cfg(test)]"));
 assert.match(receipt,/Command::new\("git"\)/);
 assert.match(receipt,/current_dir\(path\)/);
});
test("device signed domain-separated receipt binds exact identity, head, digest and time",()=>{
 for(const item of ["KatoSync-Stage4AE-device-git-head-receipt-v1",
  "owner_id","tenant_id","owner_session_id","client_id","project_id","task_id","nonce",
  "device_key","expected_head","measured_head","stdout_digest","permit_digest",
  "expected_head_len","finished_at_ms","exit_code","device_key.sign",
  "Signature::from_bytes"]){
  assert.ok(receipt.includes(item),item);
 }
 assert.match(receipt,/expected_device\s*\.verify\s*\(/);
 assert.match(receipt,/actual\s*!=\s*task\.expected_head/);
 assert.match(receipt,/MAX_HEAD_OUTPUT/);
 assert.match(receipt,/task\.action\s*!=\s*Action::GitHead/);
});
test("persist requires verified device signature and two reserved markers, never fabricates completion",()=>{
 assert.match(receipt,/verify_receipt\(signed,\s*task,\s*device,\s*stdout\)/);
 assert.match(receipt,/store_verified_terminal_record/);
 assert.match(journal,/marker\(&self.root,\s*"task",\s*task_id\)/);
 assert.match(journal,/marker\(&self.root,\s*"nonce",\s*nonce\)/);
 assert.match(journal,/marker\(&self.root,\s*"receipt",\s*task_id\)/);
 assert.match(journal,/create_new\(true\)/);
 assert.match(journal,/sync_all\(\)/);
 assert.doesNotMatch(receipt.slice(0,receipt.indexOf("#[cfg(test)]")),/fn execute_job|git push|git commit/);
});
test("real isolated Git fixture tests tamper, wrong signer, wrong HEAD and double receipt",()=>{
 for(const name of [
  "actual_isolated_git_head_is_signed_and_verifiable",
  "changed_output_and_tampered_receipt_fail_closed",
  "wrong_device_never_signs_nor_verifies",
  "expiry_or_wrong_expected_head_fails_even_if_git_stdout_valid",
  "typed_status_or_mutating_command_never_produces_head_receipt",
  "signed_receipt_persists_once_and_cannot_be_replayed_after_reopen",
  "altered_signature_or_missing_reservation_cannot_persist_completion"
 ]) assert.ok(receipt.includes(name),name);
 assert.match(receipt,/commit",\s*"--allow-empty"/);
 assert.match(receipt,/rev-parse",\s*"HEAD"/);
});
test("native CI tests actual bounded receipt without deploying device access",()=>{
 assert.match(workflow,/mesh_durable_lease_qa::signed_job_qa::receipt_qa::tests/);
 assert.match(workflow,/meshStage4AESignedReceiptContract.test.mjs/);
 assert.match(workflow,/cargo test --locked/);
 assert.match(workflow,/STAGE4AE_DEVICE_RECEIPT_QA_ONLY_NO_REMOTE/);
 assert.doesNotMatch(workflow,/wrangler deploy|supabase db push|cargo tauri build|codesign -s/);
});

// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const admission=read("src-tauri/src/mesh_admission.rs");
const native=read("src-tauri/src/mesh_private_lan_qa.rs");
const lib=read("src-tauri/src/lib.rs");

test("QA-only diagnostic reuses both pre/post live owner admission gates",()=>{
  assert.match(admission,/#\[cfg\(feature = "stage4j-qa"\)\]\s*pub\(crate\) async fn stage4y_qa_admission_diagnostic/);
  assert.match(admission,/if !exact_public_fingerprint\(requested_fingerprint\)/);
  assert.match(admission,/let admitted = authorize\(requested_fingerprint\)/);
  assert.match(admission,/recheck_after_probe\(&admitted, requested_fingerprint\)/);
  assert.doesNotMatch(admission.slice(admission.indexOf("pub(crate) async fn stage4y_qa_admission_diagnostic"), admission.indexOf("mod stage4y_diagnostics_tests")),
    /ensure_identity|set_password|TcpListener|TcpStream|remote_dispatch|execute_command/);
});
test("CLI is double-gated by isolated QA build, owner opt-in and one-shot concurrency",()=>{
  assert.match(lib,/--stage4y-admission-qa-once/);
  assert.match(lib,/#\[cfg\(feature = "stage4j-qa"\)\]/);
  assert.match(lib,/MESH_STAGE4Y_QA_NOT_CONFIGURED/);
  assert.match(native,/pub\(crate\) async fn run_cli_admission_diagnostic_once/);
  // The caller and its native adapter must share the Stage4J feature gate.
  // Default and other QA flavors must compile without enabling Stage4Y.
  assert.match(native,/#\[cfg\(feature = "stage4j-qa"\)\]\s*pub\(crate\) async fn run_cli_admission_diagnostic_once/);
  const diagnostic=native.slice(native.indexOf("pub(crate) async fn run_cli_admission_diagnostic_once"),native.indexOf("pub(crate) async fn run_cli_once"));
  assert.match(diagnostic,/gate\(\)\?/);
  assert.match(diagnostic,/SingleQaPermit::acquire\(\)/);
  assert.match(diagnostic,/args\.len\(\) != 1/);
  assert.match(diagnostic,/stage4y_qa_admission_diagnostic\(&args\[0\]\)/);
});
test("only static safe error categories are surfaced; no tokens, peers or identifiers",()=>{
  assert.match(admission,/fn stage4y_safe_failure\(error: &str\) -> &'static str/);
  for(const term of ["SESSION_UNVERIFIED","LOCAL_IDENTITY_UNVERIFIED","PEER_APPROVAL_UNVERIFIED","ENROLLMENT_UNVERIFIED","ACCOUNT_CHANGED","ADMISSION_UNVERIFIED"]){
    assert.match(admission,new RegExp("MESH_STAGE4Y_"+term));
  }
  assert.match(admission,/_ => "MESH_STAGE4Y_ADMISSION_UNVERIFIED"/);
  assert.match(native,/MESH_STAGE4Y_DIAGNOSTIC_ARGUMENTS_DENIED/);
});
test("diagnostic does not register any additional Tauri commands",()=>{
  assert.doesNotMatch(lib,/mesh_admission::stage4y_qa_admission_diagnostic\s*,/);
  assert.doesNotMatch(admission,/#\[tauri::command\][\s\S]{0,120}stage4y_qa_admission_diagnostic/);
});

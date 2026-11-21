// Created by NMKato Solutions – UX4 Mesh private-beta source contract.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const get = (name:string) => readFileSync(new URL("../"+name, import.meta.url),"utf8");
const cargo=get("src-tauri/Cargo.toml");
const source=get("src-tauri/src/lib.rs");
const coordinator=get("src-tauri/src/app_instance.rs");

test("UX4 Mesh is additive and includes BOTH KATOOS QA isolation and Stage4J consent gates",()=>{
  assert.match(cargo,/ux4-auth-qa = \["katoos-auth-qa"\]/);
  assert.match(cargo,/ux4-mesh-qa = \["ux4-auth-qa", "stage4j-qa"\]/);
  assert.match(cargo,/stage4j-qa = \["stage35-qa"\]/);
  assert.match(cargo,/default = \["custom-protocol"\]/);
  assert.doesNotMatch(cargo,/default = [^\n]*ux4-mesh-qa/);
});
test("Stage4J native Mesh remains behind its previous compile-time gates",()=>{
  assert.match(source,/#\[cfg\(feature = "stage4j-qa"\)\]\s*mod mesh_account_control;/);
  assert.match(source,/#\[cfg\(feature = "stage4j-qa"\)\]\s*mod mesh_live_supervisor_qa;/);
  assert.match(source,/async fn mesh_account_network_get\(\)/);
  assert.match(source,/mesh_account_json\(mesh_account_control::mesh_account_network_get\(\)\.await\?\)/);
  assert.match(source,/mesh_account_connection_start\(/);
  assert.match(source,/mesh_account_peer_approve\(/);
  assert.match(source,/#\[cfg\(not\(feature = "stage4j-qa"\)\)\]/);
});
test("UX4 private credentials, data directory and launch agent remain distinct from C11 Stage4J",()=>{
  assert.match(source,/#\[cfg\(feature = "ux4-auth-qa"\)\]\s*const KEYCHAIN_SERVICE: &str = "com\.nmkato\.katosync\.katoos\.ux4\.qa"/);
  assert.match(source,/#\[cfg\(feature = "ux4-auth-qa"\)\]\s*const LAUNCH_AGENT_ID: &str = "com\.nmkato\.katosync\.ux4\.qa\.sync"/);
  assert.equal((source.match(/\.join\(if cfg!\(feature = "ux4-auth-qa"\)/g) || []).length,2);
  assert.match(coordinator,/fn lock_for_session\(/);
  assert.match(coordinator,/INSTANCE_ALREADY_RUNNING/);
  assert.match(coordinator,/Never invoke AppleScript here/);
});
test("Mesh transport remains explicit and profile-controlled, never a global task or file grant",()=>{
  const card=get("src/components/AccountDevicesCard.tsx");
  const context=get("src/contexts/AccountMeshContext.tsx");
  assert.match(card,/onClick=\{\(\) => void model\.connect\(selected\.deviceId, mode\)\}/);
  assert.match(context,/mesh_account_connection_resume/);
  assert.match(context,/Automatic|automatic/);
  assert.match(context,/mesh_account_peer_approve/);
  assert.doesNotMatch(card,/(?:autoApprove|grantAllPermissions|runArbitraryShell)/);
});

// NMKato Solutions — Stage 2M native signing boundary and truthful QA UI contract.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
const rust=read("../src-tauri/src/mesh_inbox.rs");
const core=read("../src-tauri/src/mesh_identity.rs");
const lib=read("../src-tauri/src/lib.rs");
const view=read("../src/components/MeshConnectionCard.tsx");
// Stage 2N adds separate opt-in delivery; Stage 2M's preparation boundary remains read-only.
const prepareFunction=rust.split("async fn prepare_inbox_message(")[1]
  .split("/// Only creates a public native")[0];
const prepareUi=view.split("const prepareNativeInbox=async(")[1]
  .split("const loadAccountDirectory=async(")[0];


test("the sender is a native Tauri command, built only with the existing Keychain signing key",()=>{
 assert.match(lib,/mod mesh_inbox;/);
 assert.match(lib,/mesh_inbox::mesh_inbox_invite_prepare/);
 assert.match(rust,/pub async fn mesh_inbox_invite_prepare\(/);
 assert.match(rust,/existing_identity\(&uid\)/);
 assert.doesNotMatch(prepareFunction,/ensure_identity\(|SigningKey::generate|set_password|localStorage|remote_job_execute/);
 assert.match(core,/pub\(crate\) fn generate_offer/);
});
test("owner scoped registry and native crypto bind source and target before preparing",()=>{
 for(const required of [
  /verified_katosync_user\(\)/,/same_account_still_verified\(&uid\)/,
  /Accept-Profile/,/owner_user_id/,/signing_public_key/,
  /membership_state != "discovered"/,/revoked_at\.is_some\(\)/,
  /source == target/,/identify_pair\(/,/key\.sign\(delivery_message/,
  /store_outbound_offer/]){
  assert.match(rust,required);
 }
 assert.doesNotMatch(prepareFunction,/\.post\(|\.patch\(|\.delete\(|TcpListener/);
});
test("new native UI marks preparation only, never delivered or paired",()=>{
 assert.match(view,/invoke<NativeInboxInvite>\("mesh_inbox_invite_prepare"/);
 assert.match(view,/result.targetDeviceId!==targetDeviceId/);
 assert.match(view,/mesh\.inbox\.notSent/);
 assert.match(view,/nativeInboxError/);
 assert.doesNotMatch(prepareUi,/mesh_inbox_invite_send|mesh_inbox_invite_approve/);
});
test("messages are localized in all four supported languages",()=>{
 for(const lang of ["de","en","es","ru"]){
  const catalog=read("../src/i18n/locales/"+lang+".ts");
  for(const key of ["prepare","prepared","notSent","failed"])
   assert.ok(catalog.includes('"mesh.inbox.'+key+'":'));
 }
});

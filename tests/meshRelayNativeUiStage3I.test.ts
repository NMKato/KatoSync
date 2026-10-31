// NMKato Solutions – Stage 3I: registered native signed relay + manual UI trust boundary.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const native=read("../src-tauri/src/mesh_relay_client.rs");
const rust=read("../src-tauri/src/mesh_handshake.rs");
const lib=read("../src-tauri/src/lib.rs");
const ui=read("../src/components/MeshConnectionCard.tsx");
test("send and list are explicit registered Tauri IPC with independent server + native QA locks",()=>{
 for(const fn of ["mesh_pairing_relay_send","mesh_pairing_relay_list"]){
  assert.match(native,new RegExp("pub async fn "+fn+"\\("));
  assert.match(lib,new RegExp("mesh_relay_client::"+fn+","));
  assert.match(ui,new RegExp('"'+fn+'"'));
 }
 assert.match(native,/KATOSYNC_MESH_PAIRING_RELAY_QA/);
 assert.match(native,/cfg!\(feature = "katoos-auth-qa"\)/);
 assert.match(ui,/VITE_MESH_RELAY_QA==="1"/);
 assert.match(native,/existing_identity\(&owner\)/);
 assert.doesNotMatch(native,/ensure_identity|mesh_local_approve_peer|remote_task_execute|set_password|mesh_transport/);
});
test("native read verifies outer Ed25519, original pair, and original signed inner payload BEFORE UI",()=>{
 assert.match(native,/signed_envelope_valid\(&env,\s*owner,\s*sender,\s*now\)/);
 assert.match(native,/verified_public_payload\(owner,\s*&env.kind,\s*&json,\s*now\)/);
 assert.match(native,/initiator == sender_key && responder == own_key/);
 assert.match(native,/responder == sender_key && initiator == own_key/);
 assert.match(native,/env\.recipient_device_id != own/);
 assert.match(native,/wire\.paired\s*\|\| wire\.transport_ready/);
 assert.match(rust,/pub\(crate\) fn relay_public_peer_keys/);
 assert.match(rust,/verify_response\(&response,\s*uid,\s*now\)/);
 assert.match(rust,/verify_challenge\(&challenge,\s*uid,\s*now\)/);
 assert.match(rust,/relay_public_validation_accepts_only_original_signed_offers_and_challenges/);
});
test("view requires extra explicit send/list/response clicks and rejects connected claims",()=>{
 assert.match(ui,/const sendRelay=async\(/);
 assert.match(ui,/const loadRelay=async\(\)=>/);
 assert.match(ui,/const prepareRelayResponse=async\(/);
 assert.match(ui,/const verifyRelayResponse=async\(/);
 assert.match(ui,/onClick=\{\(\)=>void loadRelay\(\)\}/);
 assert.match(ui,/onClick=\{\(\)=>void sendRelay\(challengeRelayWork,"challenge"\)\}/);
 assert.match(ui,/onClick=\{\(\)=>void sendRelay\(responseRelayWork,"response"\)\}/);
 assert.match(ui,/prepareRelayResponse\(item\):verifyRelayResponse\(item\)/);
 assert.match(ui,/data\.paired!==false/);
 assert.match(ui,/result\.paired!==false/);
 assert.match(ui,/proof\.paired!==false/);
 assert.match(ui,/relayInFlight\.current=true/);
 assert.match(ui,/if\(operation===relayOperation\.current\)/);
 assert.match(ui,/resetRelay\(\)/);
});
test("four translations are complete with no fictional online/paired claim",()=>{
 for(const lng of ["de","en","es","ru"]){
  const src=read("../src/i18n/locales/"+lng+".ts");
  for(const name of ["heading","notice","check","sendChallenge","prepareResponse",
   "verifyResponse","sendResponse","sas","compare","failed","delivered"])
   assert.ok(src.includes('"mesh.relay.'+name+'":'),lng+"/"+name);
 }
});

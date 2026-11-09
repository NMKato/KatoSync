// NMKato Solutions — receiver contract cannot imply trust or silent acceptance.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const rust=read("../src-tauri/src/mesh_inbox_receiver.rs");
const ui=read("../src/components/MeshConnectionCard.tsx");
const lib=read("../src-tauri/src/lib.rs");

test("receiver uses the native existing device identity and does not create a new key",()=>{
 assert.match(lib,/mesh_inbox_receiver::mesh_inbox_recipient_list/);
 assert.match(lib,/mesh_inbox_receiver::mesh_inbox_recipient_decide/);
 assert.match(rust,/existing_identity\(&uid\)/);
 assert.doesNotMatch(rust,/ensure_identity\(|set_password|SigningKey::generate/);
 assert.match(rust,/receiver_qa_enabled/);
 assert.match(rust,/KATOSYNC_MESH_INBOX_RECEIVE_QA/);
 assert.match(rust,/same_account_still_verified\(&uid\)/);
});
test("every list/decision signs a fresh device request, never transfers service credentials",()=>{
 assert.match(rust,/OsRng.fill_bytes\(&mut nonce\)/);
 assert.match(rust,/\.sign\(proof_payload\(owner, &proof\)\.as_bytes\(\)\)/);
 assert.match(rust,/\/functions\/v1\/mesh-inbox-receive/);
 assert.match(rust,/mesh_inbox_recipient_list/);
 assert.match(rust,/mesh_inbox_recipient_decide/);
 assert.doesNotMatch(rust,/SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});
test("native receiver independently verifies the incoming sender signatures",()=>{
 assert.match(rust,/verify_offer\(&entry.signed_offer, uid, now\)/);
 assert.match(rust,/key.verify\(message.as_bytes\(\), &sig\)/);
 assert.match(rust,/entry.target_device_id != own_device/);
 assert.match(rust,/expires.timestamp\(\) != entry.signed_offer.expires_at/);
 assert.match(rust,/\|\| wire.paired\s+\|\| wire.transport_ready/);
 assert.match(rust,/\|\| wire.transport_ready\s+\|\| wire.remote_jobs_enabled/);
});
test("UI uses explicit accept/reject, is opt-in and does not connect on approval",()=>{
 assert.match(ui,/VITE_MESH_INBOX_RECEIVE_QA==="1"/);
 assert.match(ui,/invoke<MeshReceivedInbox>\("mesh_inbox_recipient_list"\)/);
 assert.match(ui,/invoke<MeshReceivedDecision>\("mesh_inbox_recipient_decide"/);
 assert.match(ui,/decideRecipientInvite\(item,"accept"\)/);
 assert.match(ui,/decideRecipientInvite\(item,"reject"\)/);
 assert.match(ui,/mesh.recipient.notConnected/);
 assert.doesNotMatch(ui,/mesh_inbox_recipient_decide.*remote_task_execute/);
});
test("localized receiver states in all supported languages",()=>{
 for(const lang of ["de","en","es","ru"]){
  const catalog=read("../src/i18n/locales/"+lang+".ts");
  for(const key of ["heading","refresh","empty","accept","reject","accepted","rejected","notConnected","failed"])
   assert.ok(catalog.includes('"mesh.recipient.'+key+'":'),lang+"/"+key);
 }
});

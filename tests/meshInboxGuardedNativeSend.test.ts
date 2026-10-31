// Created by NMKato Solutions – Stage 2N guarded send, no secrets/network in tests.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
const lib=read("../src-tauri/src/lib.rs");
const native=read("../src-tauri/src/mesh_inbox.rs");
const ui=read("../src/components/MeshConnectionCard.tsx");

test("send command is native, deny-by-default, and requires two independent gates",()=>{
 assert.match(lib,/mesh_inbox::mesh_inbox_invite_send/);
 assert.match(native,/pub async fn mesh_inbox_invite_send\(/);
 assert.match(native,/option_env!\("KATOSYNC_MESH_INBOX_SEND_QA"\) == Some\("1"\)/);
 assert.match(native,/!cfg!\(feature = "katoos-auth-qa"\) \|\| !send_qa_enabled\(\)/);
 assert.match(native,/prepare_inbox_message\(target_device_id\)/);
 assert.match(native,/\.post\(format!\(/);
 assert.match(native,/\/functions\/v1\/mesh-inbox-send/);
 assert.match(native,/\.bearer_auth\(token\.as_str\(\)\)/);
 assert.doesNotMatch(ui,/service_role|SUPABASE_SERVICE_ROLE_KEY|fetch\(/);
});
test("user click is explicit and never piggybacks on prepare or discovery",()=>{
 assert.match(ui,/VITE_MESH_INBOX_SEND_QA==="1"/);
 assert.match(ui,/onClick=\{\(\)=>void sendNativeInbox\(selectedDevice\.deviceId\)\}/);
 assert.match(ui,/invoke<MeshInboxSentReceipt>\("mesh_inbox_invite_send"/);
 assert.match(ui,/setNativeInboxPrepared\(targetDeviceId\)/);
 assert.match(ui,/result\.deliveryOnly!==true/);
 assert.match(ui,/inboxSendEnabled\?/);
 assert.match(ui,/selectedDevice\.membershipState==="discovered"&&qaAuthEnabled/);
 assert.match(ui,/result\.paired!==false/);
 assert.match(ui,/result\.remoteJobsEnabled!==false/);
 assert.match(ui,/mesh\.inbox\.noTrust/);
 assert.doesNotMatch(ui,/setPeerCount|setConnectedPeers/);
});
test("native receipt cannot upgrade trust or leak raw backend errors",()=>{
 assert.match(native,/fn verify_receipt/);
 assert.match(native,/receipt\.paired\s*\|\|\s*receipt\.transport_ready/);
 assert.match(native,/receipt\.remote_jobs_enabled/);
 assert.match(native,/expires\.timestamp\(\) != offer\.expires_at/);
 assert.match(native,/fn classify_send_failure/);
 assert.match(native,/MESH_INBOX_INVALID_RECEIPT/);
 assert.match(native,/same_account_still_verified\(&uid\)/);
});
test("send, receipt, and caution available in four translations",()=>{
 for(const lang of ["de","en","es","ru"]){
   const text=read("../src/i18n/locales/"+lang+".ts");
   for(const key of ["send","sent","noTrust"]){
      assert.ok(text.includes('"mesh.inbox.'+key+'":'),lang+"/"+key);
   }
 }
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("the existing JWT-protected Enrollment function has a dedicated signed heartbeat route",()=>{
 const index=read("supabase/functions/mesh-device-presence-qa/index.ts");
 assert.match(index,/handleSignedMeshHeartbeat/);
 assert.doesNotMatch(index,/handleMeshEnrollmentChallenge|completeMeshDeviceDiscovery/);
 const previous=read("supabase/functions/mesh-device-enrollment/index.ts");
 assert.match(previous,/handleMeshEnrollmentChallenge/);
 assert.match(previous,/completeMeshDeviceDiscovery/);
 assert.doesNotMatch(index,/verify_jwt\s*=\s*false/);
});
test("native reports only existing Keychain identities and verified owner roster",()=>{
 const rust=read("src-tauri/src/mesh_device_presence.rs");
 const bridge=read("src-tauri/src/lib.rs");
 assert.ok(bridge.includes("mesh_device_presence::mesh_device_presence_report"));
 assert.ok(rust.includes("existing_identity(&uid)"));
 assert.ok(!rust.includes("ensure_identity(&uid)"));
 assert.ok(rust.includes("mesh_account_devices_list()"));
 assert.ok(rust.includes('if !cfg!(feature = "stage35-qa")'));
 assert.ok(rust.includes("same_account_still_verified(&uid)"));
 assert.ok(rust.includes("katosync-mesh-device-heartbeat-v1"));
 assert.ok(rust.includes("mesh-device-presence-qa"));
 assert.ok(rust.includes("receipt.remote_jobs_enabled"));
});
test("heartbeat is QA-gated, throttled and is never called as enrollment or pairing",()=>{
 const src=read("src/components/MeshConnectionCard.tsx");
 const begin=src.indexOf("// Optional signed QA heartbeat");
 const end=src.indexOf("}catch{",begin);
 assert.ok(begin>0&&end>begin);
 const relevant=src.slice(begin,end);
 assert.ok(relevant.includes('VITE_STAGE35_HEARTBEAT_QA==="1"'));
 assert.ok(relevant.includes("lastPresenceAttempt.current>=600_000"));
 assert.ok(relevant.includes('invoke<MeshPresenceReceipt>("mesh_device_presence_report")'));
 for(const forbidden of ["mesh_account_device_discover","mesh_local_approve_peer",
   "mesh_inbox_invite_send","mesh_pairing_relay_send","remote_task_execute"]){
  assert.ok(!relevant.includes(forbidden),forbidden);
 }
});
test("server constrains every write to authenticated owner, key, status and rate window",()=>{
 const server=read("supabase/functions/mesh-device-presence-qa/heartbeat.ts");
 for(const key of ['"owner_user_id"','"device_id"','"signing_public_key"',
   '"membership_state"','"revoked_at"','"or"']){
  assert.ok(server.includes(key),key);
 }
 assert.ok(server.includes('crypto.subtle.verify("Ed25519"'));
 assert.ok(server.includes('MIN_REFRESH_MS=5*60_000'));
 assert.ok(server.includes('readMeshDeviceAllowance'));
 assert.ok(server.includes('requireKatoSyncMembership'));
 assert.ok(server.includes("PRESENCE_RACE_OR_REVOKED"));
 assert.ok(!server.includes("public.katoos_subscription"));
});

test("an in-progress roster operation schedules another heartbeat check",()=>{
 const src=read("src/components/MeshConnectionCard.tsx");
 const start=src.indexOf("// Stage 3.5: authenticated first-start");
 const end=src.indexOf("const startConnectionGuide",start);
 const part=src.slice(start,end);
 assert.ok(part.includes("window.setTimeout(()=>void checkColleagues(),30_000)"));
 assert.ok(part.includes('presenceIdentity.current!==myAgent.fingerprint'));
 assert.ok(part.includes('lastPresenceAttempt.current=0'));
 assert.ok(part.includes('window.clearTimeout(timer)'));
 assert.ok(!part.includes("setInterval"));
});

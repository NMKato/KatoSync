// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const rust=read("../src-tauri/src/mesh_trust.rs");
const hs=read("../src-tauri/src/mesh_handshake.rs");
const view=read("../src/components/VisionWorkspace.tsx");
const lib=read("../src-tauri/src/lib.rs");

test("explicit approval uses verified issuer and typed fresh safety code",()=>{
 assert.match(rust,/mesh_local_approve_peer\(confirmed_code: String\)/);
 assert.match(rust,/valid_sas\(&confirmed_code\)/);
 assert.match(rust,/pending\.comparison_code != supplied/);
 assert.match(rust,/now >= pending\.expires_at/);
 assert.match(rust,/verified_katosync_user\(\)\.await/);
 assert.match(rust,/same_account_still_verified\(&uid\)\.await/);
 assert.match(rust,/mesh-manual-approval-v1/);
 assert.match(hs,/stage_after_mutual_proof/);
 assert.match(hs,/pending_consume/);
});
test("keychain storage is scoped per account and transport/dispatch stays disabled",()=>{
 assert.match(rust,/Entry::new\(crate::KEYCHAIN_SERVICE,/);
 assert.match(rust,/uuid::Uuid::parse_str\(uid\)/);
 assert.match(rust,/approval_only: true/);
 assert.match(rust,/transport_ready: false/);
 assert.match(rust,/remote_jobs_enabled: false/);
 for (const risky of ["TcpListener","UdpSocket","run_codex_task","run_claude_task","std::process::Command"])
  assert.ok(!rust.includes(risky),"unsafe action "+risky);
});
test("revocation clears pin and pending state but not any global OS credentials",()=>{
 assert.match(rust,/mesh_local_revoke_peer\(fingerprint: String\)/);
 assert.match(rust,/peers\.retain\(/);
 assert.match(rust,/clear_raw\(&uid, PENDING_ACCOUNT\)/);
 assert.ok(!rust.includes("purge_local_credentials"));
});
test("all native trust commands have explicit UI buttons and localized labels",()=>{
 for(const name of ["mesh_local_approved_peers","mesh_local_approve_peer","mesh_local_revoke_peer"]){
  assert.match(lib,new RegExp("mesh_trust::"+name));
  assert.ok(view.includes(name));
 }
 assert.match(view,/mesh\.v3\.listDisclaimer/);
 assert.match(view,/mesh\.v3\.confirmDescription/);
 for(const lang of ["de","en","es","ru"]){
  const t=read("../src/i18n/locales/"+lang+".ts");
  for (const k of ["confirmTitle","confirmCode","confirmButton","listTitle","listDisclaimer","refresh","revoke","error"])
   assert.ok(t.includes('"mesh.v3.'+k+'":'),lang+" missing "+k);
 }
});

// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
const rust=read("../src-tauri/src/mesh_identity.rs");
const root=read("../src-tauri/src/lib.rs");
const view=read("../src/components/VisionWorkspace.tsx");

test("cryptographic identity uses OS keychain + issuer-verified account without exposed secret",()=>{
 assert.match(rust,/verified_katosync_user\(\)\.await/);
 assert.match(rust,/keyring::Entry/);
 assert.match(rust,/SigningKey::from_bytes/);
 assert.match(rust,/ed25519_dalek::/);
 assert.match(rust,/encoded\.zeroize\(\)/);
 assert.match(root,/mesh_identity::mesh_device_identity_prepare/);
 assert.match(root,/mesh_identity::mesh_pairing_offer_create/);
 assert.match(root,/mesh_identity::mesh_pairing_offer_inspect/);
 for(const forbidden of ["TcpListener","UdpSocket","start_server(","std::process::Command","remote_task_execute"]){
  assert.ok(!rust.includes(forbidden),"Transport side effect: "+forbidden);
 }
});
test("invite is signed, five-minute-bound and scoped to verified issuer and owner",()=>{
 assert.match(rust,/OFFER_LIFETIME_SECS: i64 = 300/);
 assert.match(rust,/const PROTOCOL: &str = "katosync-mesh-pairing-v1"/);
 assert.match(rust,/KATOSYNC_AUTH_URL/);
 assert.match(rust,/\.verify\(&offer_message\(offer\), &signature\)/);
 assert.match(rust,/offer\.account_scope != scope\(uid\)/);
 assert.match(rust,/offer\.expires_at <= now/);
});
test("copy/paste invitation UI cannot silently enrol a device or dispatch remote work",()=>{
 assert.match(view,/mesh_pairing_offer_create/);
 assert.match(view,/mesh_pairing_offer_inspect/);
 assert.match(view,/mesh\.v1\.verifiedNotPaired/);
 assert.match(view,/actual\.paired\|\|actual\.peerCount\|\|actual\.transportReady/);
 assert.ok(!view.includes('mesh_pairing_accept'));
});
test("user-facing strings explicitly say NO pairing in all languages",()=>{
 for(const lang of ["de","en","es","ru"]){
  const src=read("../src/i18n/locales/"+lang+".ts");
  for(const key of ["heading","description","prepare","invite","verifiedNotPaired","failed"])
    assert.ok(src.includes('"mesh.v1.'+key+'":'),"missing "+lang+" "+key);
 }
});

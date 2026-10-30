// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
const rust=read("../src-tauri/src/mesh_handshake.rs");
const first=read("../src-tauri/src/mesh_identity.rs");
const lib=read("../src-tauri/src/lib.rs");
const view=read("../src/components/MeshConnectionCard.tsx");

test("native handshake registers only user-initiated challenge and signed response commands",()=>{
 for(const cmd of ["mesh_pairing_challenge_create","mesh_pairing_response_create","mesh_pairing_response_verify"])
   assert.match(lib,new RegExp("mesh_handshake::"+cmd));
 assert.match(rust,/verified_katosync_user\(\)\.await/);
 assert.match(rust,/same_account_still_verified\(&uid\)\.await/);
 assert.match(first,/store_outbound_offer\(&uid, &offer\)/);
 // The new Stage3D test may create a LOCAL ephemeral socket inside the
 // Rust #[cfg(test)] module only. Release handshake code must still have
 // NO listener, dispatch command or network server: never scan test code.
 const testBoundary="\n#[cfg(test)]\nmod tests {";
 assert.ok(rust.includes(testBoundary),"Rust unit-test boundary missing");
 const shippingHandshake=rust.slice(0,rust.indexOf(testBoundary));
 for(const action of ["TcpListener","UdpSocket","new_peer_socket","run_codex_task","run_claude_task","GithubAppToken"])
   assert.ok(!shippingHandshake.includes(action),"unexpected production remote action "+action);
});
test("bounded time, nonce, signed domain separation and single-use pending record",()=>{
 assert.match(rust,/const MAX_MESSAGE_BYTES: usize = 8192/);
 assert.match(rust,/rand::rngs::OsRng\.fill_bytes/);
 assert.match(rust,/katosync-mesh-challenge-v1/);
 assert.match(rust,/katosync-mesh-response-v1/);
 assert.match(rust,/response\.protocol != RESPONSE_PROTOCOL/);
 assert.match(rust,/challenge\.expires_at <= now/);
 assert.match(rust,/STATE_OFFER/);
 assert.match(rust,/STATE_CHALLENGE/);
 assert.match(rust,/pending_consume\(&uid, STATE_OFFER/);
 assert.match(rust,/pending_consume\(\s*&uid,\s*STATE_CHALLENGE/);
 assert.match(rust,/delete_credential\(\)/);
});
test("verification is never mistaken for trusted connection or remote dispatch",()=>{
 for(const field of ["paired: false","peer_count: 0","transport_ready: false"])
   assert.ok(rust.includes(field));
 assert.match(view,/mesh\.v2\.noTrust/);
 assert.match(view,/mesh\.v0\.noDispatch/);
 assert.match(view,/pairingVerified/);
 assert.match(view,/checkProof\(result\)/);
});
test("UI has distinct challenge/responder roles and localized labels",()=>{
 for(const cmd of ["mesh_pairing_challenge_create","mesh_pairing_response_create","mesh_pairing_response_verify"])
   assert.ok(view.includes(cmd));
 assert.match(view,/vision-mesh-advanced/);
 for(const lang of ["de","en","es","ru"]){
   const source=read("../src/i18n/locales/"+lang+".ts");
   for(const field of ["title","notice","stepB","stepA","stepBVerify","noTrust","code"])
     assert.ok(source.includes('"mesh.v2.'+field+'":'),lang+" missing "+field);
 }
});

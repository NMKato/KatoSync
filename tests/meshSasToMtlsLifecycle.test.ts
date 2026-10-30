// NMKato Solutions – Stage 3D: regression contract for native pairing.
// Real cryptographic test lives in Rust; these run on Windows/Node CI.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(name:string)=>readFileSync(new URL("../src-tauri/src/"+name,import.meta.url),"utf8");
const handshake=read("mesh_handshake.rs");
const trust=read("mesh_trust.rs");
const transport=read("mesh_transport.rs");
const admission=read("mesh_admission.rs");
test("signed account-scoped invite and both signed replies produce the same SAS",()=>{
 const name="synthetic_signed_sas_to_explicit_two_sided_pin_and_real_mtls_is_fail_closed";
 assert.ok(handshake.includes("async fn "+name+"()"));
 assert.match(handshake,/let challenge = generate_challenge\(offer, &b/);
 assert.match(handshake,/verify_challenge\(&challenge, USER/);
 assert.match(handshake,/generate_response\(challenge\.clone\(\), &a\)/);
 assert.match(handshake,/verify_response\(&response, USER/);
 assert.match(handshake,/verify_response\(&response, OTHER/);
 assert.match(handshake,/a_proof\.comparison_code, b_proof\.comparison_code/);
 assert.match(handshake,/assert!\(!a_proof\.paired && !b_proof\.paired\)/);
});
test("two explicit local approvals, SAS mismatch and expiry protect real admission",()=>{
 assert.match(handshake,/let mut a_pins = Vec::new\(\)/);
 assert.match(handshake,/let mut b_pins = Vec::new\(\)/);
 assert.match(handshake,/one-sided approval must not admit the other direction/);
 assert.match(handshake,/challenge\.expires_at,\s*challenge\.expires_at/);
 assert.match(handshake,/expired_pins\.is_empty\(\)/);
 assert.match(handshake,/qa_confirm_synthetic_peer\(/);
 assert.match(handshake,/qa_synthetic_admission\(/);
 assert.match(trust,/#\[cfg\(test\)\]\s*pub\(crate\) fn qa_confirm_synthetic_peer/);
 assert.match(trust,/confirm_pending\(&pending, manually_typed_sas, now, local, peers\)/);
 assert.match(trust,/select_approved_peer\(peers, &fingerprint\(peer\), local, now\)/);
});
test("the new integration test uses actual native TLS on OS loopback and no keychain or cloud",()=>{
 assert.match(handshake,/TcpListener::bind\("127\.0\.0\.1:0"\)/);
 assert.match(handshake,/client_probe\(client, &a_tls, &approved_server/);
 assert.match(handshake,/server_probe\(server, &b_tls, &approved_client/);
 assert.match(handshake,/a_pins\.clear\(\)/);
 assert.match(handshake,/readiness\["verifiedPeers"\], 0/);
 assert.match(handshake,/readiness\["remoteReadOnlyDispatch"\], false/);
 assert.match(handshake,/readiness\["crossDeviceWrites"\], false/);
 assert.match(transport,/strict_client_config/);
 assert.match(transport,/strict_server_config/);
 const testBody=handshake.slice(handshake.indexOf("async fn synthetic_signed_sas_to_explicit_two_sided_pin_and_real_mtls_is_fail_closed"));
 const section=testBody.slice(0,testBody.indexOf("    #[test]"));
 assert.doesNotMatch(section,/\b(?:ensure_identity|Entry::new|pending_save|save_raw|supabase|verified_katosync_user)\s*\(/);
});
test("production admission still requires Keychain, approved peer, enrollment and recheck",()=>{
 assert.match(admission,/existing_identity\(&uid\)/);
 assert.match(admission,/approved_peer_for_account\(&uid/);
 assert.match(admission,/require_both_devices_enrolled\(&uid/);
 assert.match(admission,/same_account_still_verified\(&uid\)\s*\.await/);
 assert.match(admission,/recheck_after_probe\(&admitted, requested_fingerprint\)\.await/);
 assert.match(admission,/MESH_ADMISSION_NOT_CONFIGURED/);
 assert.match(trust,/clear_raw\(&uid, PENDING_ACCOUNT\)/);
 assert.match(trust,/pub async fn mesh_local_revoke_peer/);
});

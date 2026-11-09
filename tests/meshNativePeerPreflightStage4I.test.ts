// NMKato Solutions — Stage4I contract: explicit read-only native admission
// preflight from Mesh UI. No Keychain / Supabase / LAN writes in Node QA.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const src=read("src-tauri/src/mesh_admission.rs");
const handler=read("src-tauri/src/lib.rs");
const ui=read("src/components/MeshConnectionCard.tsx");
const gate=read("src-tauri/src/mesh_enrollment_gate.rs");

test("native preflight exists only as explicitly registered QA command",()=>{
 assert.match(src,/#\[tauri::command\]\s*pub async fn mesh_native_peer_preflight\(/);
 assert.match(handler,/mesh_admission::mesh_native_peer_preflight,/);
 assert.match(src,/qa_build_enabled\(\)/);
 assert.match(src,/MESH_ADMISSION_NOT_CONFIGURED/);
 assert.match(src,/let admitted = authorize\(&requested_fingerprint\)\s*\.await/);
});
test("fingerprint input is exact and cannot become a supplied key or URL",()=>{
 assert.match(src,/fn exact_public_fingerprint\(/);
 assert.match(src,/value\.len\(\) == 47/);
 assert.match(src,/byte\.is_ascii_hexdigit\(\) && !byte\.is_ascii_lowercase\(\)/);
 assert.match(src,/MESH_PREFLIGHT_INVALID_PEER/);
 const section=src.slice(src.indexOf("pub async fn mesh_native_peer_preflight("),
   src.indexOf("/// An internal service must supply"));
 assert.doesNotMatch(section,/https:\/\/|\.listen\(|TcpListener::|TcpStream::|\.bind\(|ensure_identity\(|set_password\(|save_raw\(|send_remote_job|\.post\(/);
});
test("preflight requires canonical account, exact Keychain peer pin and enrollment",()=>{
 assert.match(src,/verified_katosync_user\(\)/);
 assert.match(src,/existing_identity\(&uid\)/);
 assert.match(src,/approved_peer_for_account\(&uid, requested_fingerprint/);
 assert.match(src,/require_both_devices_enrolled\(&uid, &signing\.verifying_key\(\), &peer\)/);
 assert.match(src,/same_account_still_verified\(&uid\)\s*\.await/);
 assert.match(src,/recheck_after_probe\(&admitted, &requested_fingerprint\)/);
 assert.match(gate,/\.get\(url\)/);
 assert.doesNotMatch(gate,/\.post\(url\)|\.patch\(url\)|\.delete\(url\)/);
});
test("Tauri result is not paired, connected, trusted or authorized for jobs",()=>{
 for(const phrase of [
 "katosync-mesh-native-peer-preflight-v1",
 "admission_eligible: true","paired: false","transport_ready: false",
 "remote_jobs_enabled: false","verified_peers: 0",
 "MESH_PREFLIGHT_NOT_READY"])
  assert.ok(src.includes(phrase),phrase);
 assert.match(src,/fn stage4i_preflight_never_claims_real_pairing_or_transport_permissions/);
 assert.match(src,/fn stage4i_preflight_rejects_untrusted_peer_ids_before_network_or_keychain/);
});
test("UI performs check only by explicit button, not on mount or refresh",()=>{
 assert.match(ui,/onClick=\{\(\)=>void runNativePeerPreflight\(selectedDevice\)\}/);
 assert.match(ui,/if\(!qaAuthEnabled\|\|nativePreflightInFlight\.current/);
 assert.match(ui,/device\.membershipState==="revoked"/);
 assert.match(ui,/invoke<MeshNativePeerPreflight>\(/);
 assert.match(ui,/"mesh_native_peer_preflight",\{requestedFingerprint:device\.fingerprint\}/);
 assert.match(ui,/setNativePreflight\(\{deviceId:device\.deviceId,/);
 assert.match(ui,/result\.paired!==false/);
 assert.match(ui,/result\.transportReady!==false/);
 assert.match(ui,/result\.remoteJobsEnabled!==false/);
 assert.match(ui,/result\.verifiedPeers!==0/);
});
test("stale requests are invalidated on roster, account and selection changes",()=>{
 assert.ok(ui.match(/nativePreflightOperation\.current\+\+/g)?.length>=3);
 assert.ok(ui.match(/setNativePreflight\(null\)/g)?.length>=3);
 assert.match(ui,/operation===nativePreflightOperation\.current/);
 assert.match(ui,/nativePreflight\.fingerprint===selectedDevice\.fingerprint/);
 assert.match(ui,/selectedDeviceId!==device\.deviceId/);
 assert.match(ui,/setTimeout\(\(\)=>setNativePreflight\(null\),30_000\)/);
 assert.match(ui,/An updated local pin inventory invalidates any earlier admission result/);
});
test("all supported languages clearly distinguish preflight from pairing",()=>{
 for(const lang of ["de","en","es","ru"]){
  const tr=read("src/i18n/locales/"+lang+".ts");
  for(const key of ["mesh.nativePreflight.check","mesh.nativePreflight.eligible",
   "mesh.nativePreflight.blocked","mesh.nativePreflight.noTrust"])
   assert.ok(tr.includes('"'+key+'":'),lang+" "+key);
 }
 assert.match(ui,/t\("mesh\.nativePreflight\.noTrust"\)/);
});
test("mesh transport remains internal and no autonomous remote job is enabled",()=>{
 const from=src.indexOf("pub async fn mesh_native_peer_preflight(");
 const to=src.indexOf("/// An internal service must supply");
 const section=src.slice(from,to);
 assert.ok(from>0&&to>from);
 assert.doesNotMatch(section,/probe_client_after_approval\(|probe_server_after_approval\(|mesh_transport::/);
 assert.match(src,/pub\(crate\) async fn probe_client_after_approval\(/);
 assert.match(src,/pub\(crate\) async fn probe_server_after_approval\(/);
 assert.doesNotMatch(ui,/invoke\([^\n]*"mesh_transport::client_probe"/);
});

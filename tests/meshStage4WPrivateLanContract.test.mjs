import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const root=new URL("../",import.meta.url);
const read=path=>readFileSync(new URL(path,root),"utf8");
const native=read("src-tauri/src/mesh_private_lan_qa.rs");
const ui=read("src/components/MeshConnectionCard.tsx");
const lib=read("src-tauri/src/lib.rs");

test("native one-shot QA is opt-in, QA-only and rejects public / broad LAN access",()=>{
 assert.match(native,/cfg!\(feature = "stage4j-qa"\)/);
 assert.match(native,/KATOSYNC_STAGE4W_LAN_QA_ONCE/);
 assert.match(native,/OWNER_LAUNCHED_QA_ONLY/);
 assert.match(native,/a\.is_private\(\)/);
 assert.match(native,/b\.is_private\(\)/);
 assert.match(native,/a\.octets\(\)\[\.\.3\] == b\.octets\(\)\[\.\.3\]/);
 assert.match(native,/TcpListener::bind\(address\)/);
 assert.match(native,/drop\(listener\)/);
 assert.match(native,/ACCEPT_DEADLINE/);
 assert.match(native,/PRELUDE_DEADLINE/);
 assert.match(native,/CERT_BYTES_MAX: usize = 8192/);
});
test("native mTLS uses actual Keychain identity + live owner admission, never user-supplied trust",()=>{
 assert.match(native,/mesh_native_peer_preflight\(requested_fingerprint\.to_owned\(\)\)/);
 assert.match(native,/existing_identity\(&uid\)/);
 assert.match(native,/probe_server_after_approval\(socket, &requested_fingerprint, &certificate\)/);
 assert.match(native,/probe_client_after_approval\(socket, &requested_fingerprint, &certificate\)/);
 assert.doesNotMatch(native,/ensure_identity/);
 assert.doesNotMatch(native,/execute_command|write_file|start_process|remote_dispatch/);
 assert.match(native,/peer_authenticated_once: true/);
 assert.match(native,/channel_still_active: false/);
 assert.match(native,/remote_jobs_enabled: false/);
 assert.match(native,/cross_device_writes: false/);
});
test("QA commands are explicitly registered but only run behind native and UI gating",()=>{
 assert.match(lib,/mod mesh_private_lan_qa;/);
 assert.match(lib,/mesh_private_lan_qa::mesh_private_lan_listen_once_qa/);
 assert.match(lib,/mesh_private_lan_qa::mesh_private_lan_connect_once_qa/);
 assert.match(ui,/VITE_STAGE4W_LAN_QA==="1"/);
 assert.match(ui,/lanQaEnabled\?<details/);
 assert.match(ui,/lanQaConsent/);
 assert.match(ui,/mesh_private_lan_listen_once_qa/);
 assert.match(ui,/mesh_private_lan_connect_once_qa/);
 assert.match(ui,/channelStillActive!==false/);
 assert.match(ui,/remoteJobsEnabled!==false/);
 assert.match(ui,/crossDeviceWrites!==false/);
});
test("four locale catalogs describe non-permanent read-only TLS QA",()=>{
 for(const lang of ["de","en","ru","es"]){
  const text=read("src/i18n/locales/"+lang+".ts");
  for(const key of ["title","explanation","noRemote","localIp","peerIp","port",
   "confirm","listen","connect","running","passed","failed"]){
   assert.ok(text.includes('"mesh.stage4w.'+key+'":'),lang+" "+key);
  }
 }
});
test("client certificate exchange and strict TLS tests exist with invalid cert denial",()=>{
 assert.match(native,/bounded_public_cert_prelude_and_strict_tls_work_on_real_tcp_loopback/);
 assert.match(native,/bad_cert_length_is_rejected_before_allocation_or_tls/);
 assert.match(native,/server_probe\(server, &b_cert, &pin\(&a\), &der\)/);
 assert.match(native,/client_probe\(client, &a_cert, &pin\(&b\), &der\)/);
});

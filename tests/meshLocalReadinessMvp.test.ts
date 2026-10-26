// Created by NMKato Solutions
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const rust=source("../src-tauri/src/mesh_readiness.rs");
const root=source("../src-tauri/src/lib.rs");
const view=source("../src/components/VisionWorkspace.tsx");
const css=source("../src/styles.css");

test("native readiness command returns only local non-sensitive status",()=>{
 assert.match(root,/mod mesh_readiness;/);
 assert.match(root,/mesh_readiness::mesh_local_readiness/);
 assert.match(rust,/pub fn mesh_local_readiness\(\)/);
 assert.match(rust,/crate::local_control::daemon_heartbeat\(\)/);
 assert.match(rust,/protocol: "mesh-readonly-v0"/);
 for(const field of ['device_identity: "not_paired"','peer_transport: "not_connected"',
 'verified_peers: 0','remote_read_only_dispatch: false','cross_device_writes: false']){
   assert.ok(rust.includes(field),"Missing fail-closed "+field);
 }
 for(const forbidden of ["TcpListener","UdpSocket","HttpServer","listen(","Command::new","Keyring","token:","password:"]){
   assert.ok(!rust.includes(forbidden),"Unexpected side effect "+forbidden);
 }
});
test("heartbeats are local only and stale/invalid time cannot grant peer trust",()=>{
 assert.match(rust,/MAX_HEARTBEAT_AGE_SECS: i64 = 90/);
 assert.match(rust,/MAX_CLOCK_SKEW_SECS: i64 = 5/);
 assert.match(rust,/local_daemon_state/);
 assert.match(rust,/"stale"/);
 assert.match(rust,/return "unknown"/);
});
test("Vision mesh strip shows explicitly unpaired peer and remote writer blocked",()=>{
 assert.match(view,/<MeshReadinessStrip\s*\/>/);
 assert.match(view,/invoke<MeshLocalReadiness>\("mesh_local_readiness"\)/);
 assert.match(view,/actual\.verifiedPeers!==0/);
 assert.match(view,/actual\.remoteReadOnlyDispatch \|\| actual\.crossDeviceWrites/);
 assert.match(view,/mesh\.v0\.notPaired/);
 assert.match(view,/mesh\.v0\.noDispatch/);
 assert.match(css,/\.vision-mesh-readiness/);
});
test("all user-visible mesh messages exist in each locale",()=>{
 for(const lang of ["de","en","es","ru"]){
   const locale=source("../src/i18n/locales/"+lang+".ts");
   for(const k of ["title","subtitle","fresh","stale","unknown","notPaired",
   "noDispatch","trustBoundary","unavailable","check"]){
     assert.ok(locale.includes('"mesh.v0.'+k+'":'),lang+" missing "+k);
   }
 }
});

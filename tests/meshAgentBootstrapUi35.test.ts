import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const code=read("src/components/MeshConnectionCard.tsx");
test("login prepares local identity and reads Mesh roster automatically, never auto-trust",()=>{
 const from=code.indexOf("// Stage 3.5: authenticated first-start auto-introduction");
 const to=code.indexOf("const startConnectionGuide",from);
 assert.ok(from>0&&to>from);
 const isolated=code.slice(from,to);
 assert.ok(isolated.includes('invoke<{loggedIn:boolean}>("supabase_session_status")'));
 assert.ok(isolated.includes('invoke<MeshAgentBootstrapSnapshot>("mesh_agent_bootstrap_snapshot")'));
 assert.ok(isolated.includes('invoke<MeshAccountDirectory>("mesh_account_devices_list")'));
 assert.ok(isolated.includes("setTimeout"));
 assert.ok(isolated.includes("120_000"));
 assert.ok(isolated.includes("stillMe.fingerprint!==myAgent.fingerprint"));
 assert.ok(isolated.includes("rosterOperationAtStart!==rosterOperation.current"));
 for(const unsafe of ["mesh_account_device_discover","mesh_local_approve_peer","mesh_pairing_relay_send","mesh_inbox_invite_send"]) {
  assert.ok(!isolated.includes(unsafe),unsafe);
 }
});
test("all supported locales have agent persona and pairing-gate copy",()=>{
 for(const lang of ["de","en","es","ru"]){
  const file=read("src/i18n/locales/"+lang+".ts");
  for(const key of ["identity","hardware","colleague","noColleagues","pendingTrust"]){
   assert.ok(file.includes('"mesh.agent35.'+key+'":'),lang+" "+key);
  }
 }
});
test("bootstrap never claims a peer connection or remote write permission",()=>{
 const source=read("src-tauri/src/mesh_agent_bootstrap.rs");
 const ix=source.indexOf("Ok(AgentBootstrapSnapshot {");
 assert.ok(ix>0);
 const result=source.slice(ix,ix+550);
 assert.ok(result.includes("trusted_peers: 0"));
 assert.ok(result.includes("transport_ready: false"));
 assert.ok(result.includes("remote_jobs_enabled: false"));
});

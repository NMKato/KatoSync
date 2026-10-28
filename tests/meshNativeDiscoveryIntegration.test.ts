import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const ui=read("../src/components/MeshConnectionCard.tsx");
const native=read("../src-tauri/src/mesh_enrollment_client.rs");
const identity=read("../src-tauri/src/mesh_identity.rs");
const registry=read("../src-tauri/src/mesh_directory.rs");
const root=read("../src-tauri/src/lib.rs");
test("Scan uses native signed discovery; not an implicit login side effect",()=>{
 assert.ok(ui.includes('invoke<MeshAccountDirectory>("mesh_account_device_discover")'));
 assert.ok(native.includes("pub async fn mesh_account_device_discover"));
 assert.ok(root.includes("mesh_enrollment_client::mesh_account_device_discover,"));
 assert.ok(native.includes('cfg!(feature = "katoos-auth-qa")'));
 assert.ok(!ui.includes("useEffect(()=>void loadAccountDirectory()"));
});
test("native enrollment is bounded to canonical KATOOS, online issuer and secure keychain",()=>{
 for(const needle of ["verified_katosync_user","ensure_supabase_access_token","ensure_identity","mesh_device_enrollment_proof",
   "same_account_still_verified","KATOSYNC_AUTH_URL","KATOSYNC_AUTH_ANON_KEY","Zeroizing"])
  assert.ok(native.includes(needle),needle);
 assert.ok(identity.includes("katosync-mesh-device-enrollment-proof-v1"));
 assert.ok(!native.includes("remote_task_execute"));
 assert.ok(!native.includes("TcpListener"));
});
test("no fake pairing, direct client database writes or remote permissions",()=>{
 for(const flag of ["!receipt.discovered","receipt.paired","receipt.transport_ready","receipt.remote_jobs_enabled"]) assert.ok(native.includes(flag));
 assert.ok(native.includes("mesh_account_devices_list().await"));
 assert.ok(registry.includes("discovery_only: true"));
 assert.ok(registry.includes("remote_jobs_enabled: false"));
 assert.ok(!native.includes("/rest/v1/katosync_mesh_devices"));
});

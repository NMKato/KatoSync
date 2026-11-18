// Stage 3R: frontend-to-native readiness contract, never handles secrets.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../",import.meta.url);
const read=(path:string)=>readFileSync(new URL(path,root),"utf8");
const native=read("src-tauri/src/mesh_native_issuer.rs");
const bridge=read("src-tauri/src/lib.rs");
const ui=read("src/components/MeshConnectionCard.tsx");
test("registered Rust Tauri command advertises truthful isolated-issuer status",()=>{
 assert.match(bridge,/mod mesh_native_issuer;/);
 assert.match(bridge,/mesh_native_issuer::mesh_native_issuer_readiness,/);
 assert.match(native,/#\[tauri::command\]/);
 assert.match(native,/pub fn mesh_native_issuer_readiness/);
 for(const claim of [
 "current_session_reusable_for_preview: false",
 "preview_token_store_isolated: false",
 "preview_cloud_probe_enabled: false",
 "online_preview_verified: false",
 "device_pairing_enabled: false",
 "remote_jobs_enabled: false"
 ])assert.ok(native.includes(claim),claim);
 assert.doesNotMatch(native,/ensure_supabase_access_token\(|get_password\(|set_password\(|reqwest::/);
});
test("Mesh card reports old app builds without implying preview is live",()=>{
 assert.match(ui,/invoke<MeshNativeIssuerReadiness>\("mesh_native_issuer_readiness"\)/);
 assert.match(ui,/\.catch\(\(\)=>null\)/);
 assert.match(ui,/setIssuerSnapshot\(issuerValid\?issuer:null\)/);
 assert.match(ui,/mesh\.issuer\.olderBuild/);
 assert.match(ui,/mesh\.issuer\.separateLogin/);
 assert.doesNotMatch(ui,/setSnapshot\(issuer\)/);
});
test("user-facing diagnostics are localized in all supported UI languages",()=>{
 for(const lang of ["de","en","ru","es"]){
  const text=read("src/i18n/locales/"+lang+".ts");
  for(const name of ["title","shared","legacy","unknown","olderBuild","separateLogin"])
   assert.ok(text.includes('"mesh.issuer.'+name+'":'),lang+":"+name);
 }
});
test("native QA build remains explicitly KATOOS-bound until independent preview login",()=>{
 assert.match(bridge,/#\[cfg\(feature = "katoos-auth-qa"\)\]\s*const KATOSYNC_AUTH_URL:/);
 assert.match(bridge,/#\[cfg\(not\(feature = "katoos-auth-qa"\)\)\]\s*const KATOSYNC_AUTH_URL:/);
 const build=read("scripts/build-mesh-qa-macos.sh");
 assert.match(build,/--features katoos-auth-qa/);
 assert.doesNotMatch(build,/mesh-preview-readiness|mesh-inbox-preview/);
 assert.match(native,/independent_login_required/);
});

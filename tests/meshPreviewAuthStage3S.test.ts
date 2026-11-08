// Stage 3S native Preview auth boundary/IPC/UI contract, no secrets or live server.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(file:string)=>readFileSync(new URL("../"+file,import.meta.url),"utf8");
const native=read("src-tauri/src/mesh_preview_auth.rs");
const bridge=read("src-tauri/src/lib.rs");
const cargo=read("src-tauri/Cargo.toml");
const ui=read("src/components/MeshConnectionCard.tsx");
test("independent preview feature and four Tauri commands are registered",()=>{
 assert.match(cargo,/mesh-preview-auth-qa = \["github-login-qa"\]/);
 for(const command of [
  "mesh_preview_auth_status","mesh_preview_auth_login",
  "mesh_preview_auth_verify_session","mesh_preview_auth_logout"
 ]) {
  assert.ok(native.includes("pub "+(command==="mesh_preview_auth_status"?"fn ":"async fn ")+command));
  assert.ok(bridge.includes("mesh_preview_auth::"+command+","));
  assert.ok(ui.includes('"'+command+'"'));
 }
});
test("preview issuer only accepts an explicit isolated compile-time target",()=>{
 for(const field of [
  "KATOSYNC_MESH_PREVIEW_SUPABASE_URL","KATOSYNC_MESH_PREVIEW_PROJECT_REF",
  "KATOSYNC_MESH_PREVIEW_DEPLOYMENT_ID","KATOSYNC_MESH_PREVIEW_PUBLISHABLE_KEY"
 ])assert.ok(native.includes('option_env!("'+field+'")'));
 assert.match(native,/parse_preview_target\(origin, reference, deployment\)/);
 assert.match(native,/starts_with\("sb_publishable_"\)/);
 assert.match(native,/if !cfg!\(feature = "mesh-preview-auth-qa"\)/);
 assert.doesNotMatch(native,/crate::ensure_supabase_access_token|supabase_session_keychain_entry|KATOSYNC_AUTH_ANON_KEY|load_supabase_refresh_token|KATOSYNC_AUTH_URL/);
});
test("separate Keychain, single-account marker and online issuer verification",()=>{
 assert.match(native,/com\.nmkato\.katosync\.mesh\.preview\.auth\.qa/);
 assert.match(native,/isolated-preview-refresh-v1/);
 assert.match(native,/previous\.owner_id != identity\.id|previous\.owner_id\s*!=\s*identity\.id/);
 assert.match(native,/identity\.id\s*!=\s*previous\.owner_id/);
 assert.match(native,/grant_type=\{kind\}/);
 assert.match(native,/\/auth\/v1\/user/);
 assert.match(native,/redirect\(reqwest::redirect::Policy::none\(\)\)/);
 assert.match(native,/let _guard = transition\(\)\.lock\(\)\.await/);
 assert.match(native,/fn drop\(&mut self\)/);
});
test("password is never returned; mesh access remains disabled",()=>{
 assert.doesNotMatch(native,/pub struct PreviewAuthStatus\s*\{[^}]*access_token/s);
 assert.doesNotMatch(native,/pub struct PreviewAuthStatus\s*\{[^}]*refresh_token/s);
 assert.match(native,/paired: false/);
 assert.match(native,/transport_ready: false/);
 assert.match(native,/remote_jobs_enabled: false/);
 assert.match(ui,/previewStatus\?\.configured/);
 assert.ok(ui.includes('setPreviewPassword("");'));
});
test("preview UI has localized login, verification and logout controls",()=>{
 for(const language of ["de","en","es","ru"]){
  const messages=read("src/i18n/locales/"+language+".ts");
  for(const k of ["title","description","notConfigured","oldBuild","verified","notLoggedIn","login","verify","logout","error","noTrust"])
   assert.ok(messages.includes('"mesh.preview.'+k+'":'),language+":"+k);
 }
 assert.match(ui,/mesh\.preview\.noTrust/);
});

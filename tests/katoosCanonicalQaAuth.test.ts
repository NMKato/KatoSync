// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(name:string)=>readFileSync(new URL(name,import.meta.url),"utf8");
const rust=read("../src-tauri/src/lib.rs");
const gh=read("../src-tauri/src/github_app_auth.rs");
const cargo=read("../src-tauri/Cargo.toml");
const app=read("../src/App.tsx");
const mesh=read("../src-tauri/src/mesh_identity.rs");
test("isolated KATOOS QA issuer and publishable client key, no shadow registration",()=>{
 assert.match(cargo,/katoos-auth-qa = \["github-login-qa"\]/);
 assert.match(rust,/#\[cfg\(feature = "katoos-auth-qa"\)\]\s*const KATOSYNC_AUTH_URL: &str = "https:\/\/xbnnlyyxiilklsygxcof.supabase.co"/);
 assert.match(rust,/#\[cfg\(not\(feature = "katoos-auth-qa"\)\)\]\s*const KATOSYNC_AUTH_URL: &str = "https:\/\/wspcuiylctlrvvpnwufk.supabase.co"/);
 assert.match(rust,/sb_publishable_/);
 assert.match(rust,/KATOOS-Test: neue Konten nur auf der offiziellen KATOOS-Seite/);
 assert.match(rust,/KATOOS-Test: Passwort-Reset nur auf der offiziellen KATOOS-Seite/);
});
test("QA isolates issuer scoped session and device identity secrets",()=>{
 assert.match(rust,/com\.nmkato\.katosync\.katoos\.auth\.qa/);
 assert.match(gh,/com\.nmkato\.katosync\.katoos\.auth\.qa/);
 assert.match(rust,/KatoSync KATOOS Auth QA/);
 assert.match(mesh,/KATOSYNC_AUTH_URL/);
 assert.match(rust,/GitHub Login QA: Synchronisation deaktiviert/);
 assert.match(rust,/GitHub Login QA: LaunchAgents deaktiviert/);
});
test("QA cannot modify canonical KATOOS cloud profile",()=>{
 assert.match(rust,/KATOOS-Test: Cloud-Profil-Änderungen deaktiviert/);
 assert.match(rust,/KATOOS-Test: Connector-Ausgabe deaktiviert/);
 assert.match(rust,/status: "empty"\.into\(\)/);
});
test("badge is issuer checked online and never authorizes privileges",()=>{
 assert.match(rust,/async fn verified_katoos_identity_badge\(\)/);
 assert.match(rust,/github_app_auth::verified_katosync_user\(\)\.await/);
 assert.match(rust,/grants_extra_capabilities: false/);
 assert.match(app,/verified_katoos_identity_badge/);
 assert.match(app,/katoosBadgeVerified/);
 assert.match(app,/sidebar-katoos-family-badge/);
 assert.match(app,/VITE_KATOOS_AUTH_QA/);
 for(const lang of ["de","en","es","ru"]){
  const src=read("../src/i18n/locales/"+lang+".ts");
  for(const key of ["katoosFamily","katoosFamilyHint","katoosLoginSubtitle","katoosQaHint"])
   assert.ok(src.includes('"auth.'+key+'":'),lang+" missing "+key);
 }
});

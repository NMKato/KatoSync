import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(s:string)=>readFileSync(new URL("../"+s,import.meta.url),"utf8");
const native=read("src-tauri/src/mesh_katoos_shared_preflight.rs");
const lib=read("src-tauri/src/lib.rs");
const ui=read("src/components/MeshConnectionCard.tsx");

test("Stage 3U is a native opt-in KATOOS-only read-only preflight",()=>{
 assert.match(native,/cfg!\(feature\s*=\s*"katoos-auth-qa"\)/);
 assert.match(native,/CANONICAL_KATOOS/);
 assert.match(native,/rest\/v1\/account_memberships/);
 assert.match(native,/"Accept-Profile",\s*SCHEMA/);
 assert.match(native,/SCHEMA:\s*&str\s*=\s*"katosync"/);
 assert.match(native,/\.get\(/);
 assert.doesNotMatch(native,/\.post\(|\.patch\(|\.put\(|\.delete\(/);
 assert.match(lib,/mesh_katoos_shared_preflight::mesh_katoos_shared_preflight,/);
});
test("issuer, role and owner must be verified both before and after read",()=>{
 assert.match(native,/verified_katosync_user\(\)/);
 assert.match(native,/same_account_still_verified\(&owner\)/);
 assert.match(native,/decode_membership\(&body,&owner|decode_membership\(&body,\s*&owner/);
 assert.match(native,/row\.access_state\s*!=\s*"active"/);
 assert.match(native,/row\.revoked_at\.is_some\(\)/);
 assert.match(native,/Uuid::parse_str\(&row\.user_id\)/);
 assert.match(native,/\.redirect\(reqwest::redirect::Policy::none\(\)\)/);
 assert.match(native,/MAX_BODY\s*-\s*body\.len\(\)/);
});
test("preflight cannot grant pairing, transport or remote jobs",()=>{
 assert.match(native,/paired:\s*false/);
 assert.match(native,/transport_ready:\s*false/);
 assert.match(native,/remote_jobs_enabled:\s*false/);
 assert.match(ui,/sharedPreflight\?\.membership==="active"/);
 assert.match(ui,/onClick=\{\(\)=>void checkSharedKatoos\(\)\}/);
 assert.match(ui,/sharedRequest\.current\+\+/);
 assert.match(ui,/result\.discoveryAuthorized!==\(result\.membership==="active"\)/);
});
test("new shared-login UI has complete language coverage",()=>{
 for(const lang of ["de","en","es","ru"]){
  const file=read("src/i18n/locales/"+lang+".ts");
  for(const key of ["title","description","unchecked","active","notMember","error","check","noTrust"]){
   assert.ok(file.includes('"mesh.shared.'+key+'":'),lang+":"+key);
  }
 }
});

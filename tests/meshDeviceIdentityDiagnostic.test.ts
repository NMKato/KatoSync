// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyMeshIdentityFailure} from "../src/lib/meshIdentityDiagnosis.ts";
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
test("mesh account/keychain failures categorized without OS-secret leakage",()=>{
 const expectations={
  MESH_IDENTITY_ACCOUNT_UNVERIFIED:"account",
  MESH_IDENTITY_ACCOUNT_SESSION:"session",
  MESH_IDENTITY_ACCOUNT_REFRESH:"refresh",
  MESH_IDENTITY_ACCOUNT_NETWORK:"network",
  MESH_IDENTITY_ACCOUNT_INVALID:"invalid",
  MESH_IDENTITY_ACCOUNT_CHANGED:"changed",
  MESH_IDENTITY_STORE_INIT:"storeInit",
  MESH_IDENTITY_STORE_READ:"storeRead",
  MESH_IDENTITY_STORE_WRITE:"storeWrite",
  MESH_IDENTITY_STORE_READBACK:"readback",
  MESH_IDENTITY_STORE_MISMATCH:"mismatch",
  MESH_IDENTITY_STORE_CORRUPT:"corrupt"
 } as const;
 for(const [code,category] of Object.entries(expectations))
  assert.equal(classifyMeshIdentityFailure(code),category);
 assert.equal(classifyMeshIdentityFailure("secret-identity-seed"),"unknown");
 assert.equal(classifyMeshIdentityFailure({identity:"secret"}),"unknown");
});
test("native command keeps auth revalidation and cannot switch on remote jobs",()=>{
 const rust=read("../src-tauri/src/mesh_identity.rs");
 const ui=read("../src/components/VisionWorkspace.tsx");
 assert.match(rust,/pub async fn mesh_device_identity_prepare/);
 assert.match(rust,/MESH_IDENTITY_STORE_WRITE/);
 assert.match(rust,/classify_mesh_auth_failure/);
 assert.match(rust,/MESH_IDENTITY_ACCOUNT_SESSION/);
 assert.match(rust,/same_account_still_verified\(&uid\)/);
 assert.match(rust,/transport_ready: false/);
 assert.match(ui,/classifyMeshIdentityFailure\(e\)/);
 for(const loc of ["de","en","es","ru"]){
  const dict=read("../src/i18n/locales/"+loc+".ts");
  assert.match(dict,/"mesh\.identity\.diag\.storeWrite":/);
  assert.match(dict,/"mesh\.identity\.diag\.account":/);
  for(const category of ["session","refresh","network","invalid"])
   assert.ok(dict.includes('"mesh.identity.diag.'+category+'":'));
 }
});

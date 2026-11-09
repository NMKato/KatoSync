// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(x:string)=>readFileSync(new URL(x,import.meta.url),"utf8");
const rust=read("../src-tauri/src/mesh_directory.rs");
const lib=read("../src-tauri/src/lib.rs");
const view=read("../src/components/MeshConnectionCard.tsx");
test("account directory is a read-only native Tauri command gated by issuer",()=>{
  assert.match(lib,/mesh_directory::mesh_account_devices_list/);
  assert.match(rust,/verified_katosync_user\(\)\s*\.await/);
  assert.match(rust,/same_account_still_verified\(&uid\)/);
  assert.match(rust,/owner_user_id/);
  assert.match(rust,/MESH_DIRECTORY_WRONG_OWNER/);
  assert.match(rust,/\.get\(url\)/);
  assert.doesNotMatch(rust,/\.post\(|\.patch\(|\.delete\(|TcpListener|remote_task_execute/);
});
test("UI distinguishes discovery from actual peer trust and remote rights",()=>{
  assert.match(view,/mesh_account_device_discover/);
  assert.match(view,/roster\.discoveryOnly!==true/);
  assert.match(view,/roster\.transportReady!==false/);
  assert.match(view,/roster\.remoteJobsEnabled!==false/);
  assert.match(view,/mesh\.directory\.notice/);
  for(const lang of ["de","en","es","ru"]){
    const t=read("../src/i18n/locales/"+lang+".ts");
    for(const key of ["heading","refresh","empty","unavailable","notice"])
      assert.ok(t.includes('"mesh.directory.'+key+'":'));
  }
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const rust=read("src-tauri/src/mesh_enrollment_client.rs");
const ui=read("src/components/MeshConnectionCard.tsx");

test("Stage4B uses server-owned quota and a bounded, whitelisted diagnostic",()=>{
  assert.match(rust,/MAX_ERROR_BODY:\s*usize\s*=\s*256/);
  assert.match(rust,/classify_enrollment_rejection/);
  assert.match(rust,/"DEVICE_QUOTA"\s*=>\s*"MESH_DISCOVERY_DEVICE_QUOTA"/);
  assert.match(rust,/"RATE_LIMIT"\s*=>\s*"MESH_DISCOVERY_RATE_LIMIT"/);
  assert.match(rust,/deny_unknown_fields/);
  assert.match(rust,/limited_enrollment_rejection\(result\)\.await/);
  assert.match(rust,/limited_enrollment_rejection\(challenge\)\.await/);
  assert.doesNotMatch(rust,/set.*allowed_devices|update.*mesh_owner_policy/i);
});

test("Stage4B renders a distinct quota warning without granting pairing",()=>{
  assert.match(ui,/code\.includes\("MESH_DISCOVERY_DEVICE_QUOTA"\)/);
  assert.match(ui,/code\.includes\("MESH_DISCOVERY_RATE_LIMIT"\)/);
  assert.match(ui,/setDirectoryIssue\(null\)/);
  assert.match(ui,/directoryIssue==="quota"\?t\("mesh\.directory\.quotaReached"\)/);
  assert.match(ui,/directoryIssue==="rate"\?t\("mesh\.directory\.rateLimited"\)/);
  assert.match(ui,/mesh_account_device_discover/);
  assert.match(ui,/mesh_account_devices_list/);
});

test("Stage4B warning messages cover all four supported languages",()=>{
  for(const lang of ["de","en","es","ru"]){
    const file=read("src/i18n/locales/"+lang+".ts");
    for(const key of ["quotaReached","rateLimited"]){
      assert.ok(file.includes('"mesh.directory.'+key+'":'),lang+" "+key);
    }
  }
});

import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const native=readFileSync(new URL("../src-tauri/src/mesh_directory.rs",import.meta.url),"utf8");
test("PostgREST snake_case inputs are explicitly accepted without changing UI camelCase",()=>{
 assert.ok(native.includes('rename_all = "camelCase", deny_unknown_fields'));
 for(const name of ["device_id","owner_user_id","display_name","persona_name",
  "platform_os","membership_state","last_seen_at"]){
  assert.ok(native.includes('alias = "'+name+'"'),name);
 }
 assert.ok(native.includes('serde_json::from_slice(&content)'));
 assert.ok(native.includes('validate_roster(&devices, &uid)'));
 assert.ok(native.includes('postgrest_snake_case_records_become_camel_case_frontend_contract'));
 assert.ok(native.includes('duplicated_wire_alias_and_unknown_records_fail_closed'));
});
